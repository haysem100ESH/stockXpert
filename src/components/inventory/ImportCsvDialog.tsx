import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { createBatch } from '@/lib/batchInventory';
import { MEASURABLE_UNITS } from '@/lib/itemTypes';

interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ActiveIngredient {
  rowIndex: number;
  ingredient_name: string;
  strength: string | null;
}

interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
  // normalized values
  name: string;
  generic_name: string | null;
  category: string;
  manufacturer: string | null;
  batch_number: string | null;
  item_type: 'full_pcs' | 'measurable';
  unit_label: string;
  packaging_mode: 'with_strip' | 'no_strip';
  strips_per_pack: number | null;
  units_per_strip: number | null;
  units_per_pack: number | null;
  purchase_price: number;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date: string | null;
  // Pharmacy-only (optional)
  medicine_group: string | null;
  strength: string | null;
  // Pharmacy hierarchical composition (rows with empty name attach here)
  active_ingredients: ActiveIngredient[];
}

const HEADERS = [
  'name',
  'generic_name',
  'medicine_group',
  'strength',
  'category',
  'manufacturer',
  'batch_number',
  'item_type',
  'unit_label',
  'packaging_mode',
  'strips_per_pack',
  'units_per_strip',
  'units_per_pack',
  'purchase_price',
  'selling_price',
  'stock_quantity',
  'minimum_stock_level',
  'expiry_date',
];

// Pharmacy-only optional columns (may be missing in older templates / general branch)
const OPTIONAL_HEADERS = new Set(['medicine_group', 'strength']);

// Order matches HEADERS exactly:
// name, generic_name, medicine_group, strength, category, manufacturer, batch_number,
// item_type, unit_label, packaging_mode, strips_per_pack, units_per_strip, units_per_pack,
// purchase_price, selling_price, stock_quantity, minimum_stock_level, expiry_date
// Pharmacy template demonstrates hierarchical composition:
//   - Row with NAME OF ITEMS filled = new medicine
//   - Subsequent rows with empty NAME OF ITEMS = active ingredients of the
//     previous medicine (only generic_name + optional strength matter)
const SAMPLE_PHARMACY = [
  ['Snip',             'Paracetamol',                 'NSAIDS and anti-pain', '325mg',    'tablet',  'Local Pharma','BN-SNIP-01',  'full_pcs',   'strip',  'with_strip', '10', '10', '',  '3.00',  '5.00',  '50',  '10', '2027-06-30'],
  ['',                 'Pseudoephedrine Hydrochloride','',                    '15mg',     '',        '',           '',            '',           '',       '',           '',   '',   '',  '',      '',      '',    '',   ''],
  ['',                 'Chlorophenaramine maleate',   '',                     '1mg',      '',        '',           '',            '',           '',       '',           '',   '',   '',  '',      '',      '',    '',   ''],
  ['Etricox 90mg',     'Etoricoxib',                  'NSAIDS and anti-pain', '90mg',     'tablet',  'Pharmacare', 'BN-ETR-09',   'full_pcs',   'strip',  'with_strip', '3',  '10', '',  '12.00', '20.00', '30',  '5',  '2026-12-31'],
  ['Amoxicillin Syrup','Amoxicillin',                 'Antibiotics',          '250mg/5ml','syrup',   'Pfizer',     'BN-AMX-2026', 'full_pcs',   'bottle', 'no_strip',   '',   '',   '1', '45.00', '70.00', '15',  '3',  '2026-08-15'],
];

const SAMPLE_GENERAL = [
  ['Rice',           '', '', '', 'grocery',  'Local Farm', '',  'measurable', 'kg',     'no_strip', '', '', '',  '40.00',  '55.00',  '500', '50', ''],
  ['Cooking Oil 1L', '', '', '', 'grocery',  'Shemu',      '',  'full_pcs',   'bottle', 'no_strip', '', '', '1', '120.00', '150.00', '60',  '10', '2027-01-31'],
  ['Soap Bar',       '', '', '', 'cleaning', 'Lifebuoy',   '',  'full_pcs',   'piece',  'no_strip', '', '', '',  '15.00',  '20.00',  '120', '20', ''],
];

function escapeCsv(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildTemplate(mode: 'pharmacy' | 'general'): string {
  const sample = mode === 'pharmacy' ? SAMPLE_PHARMACY : SAMPLE_GENERAL;
  const lines = [HEADERS.join(',')];
  sample.forEach(row => lines.push(row.map(escapeCsv).join(',')));
  return lines.join('\n');
}

// Simple CSV parser supporting quoted fields with commas and "" escapes
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { cur.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export default function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const fileRef = useRef<HTMLInputElement>(null);

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'create_new'>('skip');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('upload');
    setParsedRows([]);
    setParseErrors([]);
    setDuplicateAction('skip');
    if (fileRef.current) fileRef.current.value = '';
    fetchBranches();
  }, [open, profile, selectedBranch]);

  const fetchBranches = async () => {
    if (!profile) return;
    if (profile.role === 'staff' && profile.branch_id) {
      setSelectedBranchId(profile.branch_id);
      return;
    }
    if (profile.role === 'owner') {
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile.id)
        .order('is_main_branch', { ascending: false })
        .order('name');
      setBranches(data || []);
      if (selectedBranch) setSelectedBranchId(selectedBranch);
      else if (data && data.length > 0) setSelectedBranchId(data[0].id);
    }
  };

  const handleDownloadTemplate = () => {
    const csv = buildTemplate(isPharmacy ? 'pharmacy' : 'general');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-import-template-${isPharmacy ? 'pharmacy' : 'general'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validateAndNormalize = async (rows: string[][]): Promise<{ ok: ParsedRow[]; errs: string[] }> => {
    const errs: string[] = [];
    if (rows.length < 2) {
      return { ok: [], errs: ['CSV is empty or has no data rows.'] };
    }

    const headerRow = rows[0].map(h => h.trim().toLowerCase());
    const missing = HEADERS.filter(h => !headerRow.includes(h) && !OPTIONAL_HEADERS.has(h));
    if (missing.length > 0) {
      return { ok: [], errs: [`Missing required column(s): ${missing.join(', ')}. Please use the provided template.`] };
    }
    const idx = (h: string) => headerRow.indexOf(h); // returns -1 if optional and absent

    // Fetch existing medicines (catalog) to detect duplicates by name+manufacturer
    const { data: existingMeds } = await supabase
      .from('medicines')
      .select('id, name, manufacturer, batch_number');
    const existingKey = new Set<string>();
    (existingMeds || []).forEach((m: any) => {
      existingKey.add(`${(m.name || '').toLowerCase().trim()}|${(m.manufacturer || '').toLowerCase().trim()}`);
    });

    const seenInFile = new Set<string>();
    const out: ParsedRow[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (k: string) => (cells[idx(k)] ?? '').trim();
      const rowErrors: string[] = [];

      const name = get('name');
      const generic_name_raw = get('generic_name');

      // ---------------------------------------------------------------
      // PHARMACY HIERARCHY: a row with empty NAME but a generic_name is
      // an active-ingredient continuation of the previous medicine.
      // ---------------------------------------------------------------
      if (isPharmacy && !name) {
        if (!generic_name_raw) {
          // Truly blank row → ignore silently
          continue;
        }
        const parent = out[out.length - 1];
        if (!parent) {
          errs.push(`Row ${r + 1}: ingredient row "${generic_name_raw}" has no parent medicine above it.`);
          continue;
        }
        parent.active_ingredients.push({
          rowIndex: r + 1,
          ingredient_name: generic_name_raw,
          strength: get('strength') || null,
        });
        continue;
      }

      if (!name) rowErrors.push('name is required');

      const category = get('category') || (isPharmacy ? 'tablet' : 'other');
      const itemTypeRaw = (get('item_type') || 'full_pcs').toLowerCase();
      const item_type: 'full_pcs' | 'measurable' = itemTypeRaw === 'measurable' ? 'measurable' : 'full_pcs';

      const unitLabelRaw = get('unit_label').toLowerCase();
      const unit_label = unitLabelRaw || (item_type === 'measurable' ? 'kg' : 'piece');
      if (item_type === 'measurable' && !MEASURABLE_UNITS.includes(unit_label as any)) {
        rowErrors.push(`unit_label "${unit_label}" must be one of: ${MEASURABLE_UNITS.join(', ')}`);
      }

      const packagingRaw = (get('packaging_mode') || 'no_strip').toLowerCase();
      const packaging_mode: 'with_strip' | 'no_strip' = packagingRaw === 'with_strip' ? 'with_strip' : 'no_strip';

      let strips_per_pack: number | null = null;
      let units_per_strip: number | null = null;
      let units_per_pack: number | null = null;

      if (item_type === 'full_pcs' && packaging_mode === 'with_strip') {
        const sp = parseInt(get('strips_per_pack'));
        const ups = parseInt(get('units_per_strip'));
        if (!sp || sp < 1) rowErrors.push('strips_per_pack must be ≥ 1 when packaging_mode=with_strip');
        if (!ups || ups < 1) rowErrors.push('units_per_strip must be ≥ 1 when packaging_mode=with_strip');
        if (sp && ups) {
          strips_per_pack = sp;
          units_per_strip = ups;
          units_per_pack = sp * ups;
        }
      } else {
        const upp = get('units_per_pack');
        if (upp) {
          const v = parseInt(upp);
          if (!isNaN(v) && v >= 1) units_per_pack = v;
        }
      }

      const purchaseRaw = get('purchase_price');
      const sellingRaw = get('selling_price');
      const purchase_price = parseFloat(purchaseRaw);
      const selling_price = parseFloat(sellingRaw);
      if (!purchaseRaw || isNaN(purchase_price) || purchase_price < 0) rowErrors.push('purchase_price is required and must be ≥ 0');
      if (!sellingRaw || isNaN(selling_price) || selling_price < 0) rowErrors.push('selling_price is required and must be ≥ 0');

      const stockRaw = get('stock_quantity');
      const stock_quantity = item_type === 'measurable' ? parseFloat(stockRaw) : parseInt(stockRaw);
      if (!stockRaw || isNaN(stock_quantity) || stock_quantity < 0) rowErrors.push('stock_quantity is required and must be ≥ 0');

      const minRaw = get('minimum_stock_level');
      const minimum_stock_level = minRaw ? parseInt(minRaw) : 0;
      if (minRaw && (isNaN(minimum_stock_level) || minimum_stock_level < 0)) rowErrors.push('minimum_stock_level must be ≥ 0');

      const expiryRaw = get('expiry_date');
      let expiry_date: string | null = null;
      if (expiryRaw) {
        const d = new Date(expiryRaw);
        if (isNaN(d.getTime())) rowErrors.push('expiry_date must be a valid date (YYYY-MM-DD)');
        else expiry_date = expiryRaw;
      }

      const generic_name = generic_name_raw || null;
      const manufacturer = get('manufacturer') || null;
      const batch_number = get('batch_number') || null;
      // Pharmacy-only optional fields
      const medicine_group = isPharmacy ? (get('medicine_group') || null) : null;
      const strength = isPharmacy ? (get('strength') || null) : null;

      const key = `${name.toLowerCase()}|${(manufacturer || '').toLowerCase()}`;
      if (seenInFile.has(key)) rowErrors.push('Duplicate row in CSV (same name + manufacturer)');
      seenInFile.add(key);
      const isDuplicate = name ? existingKey.has(key) : false;

      // Seed active_ingredients with the first ingredient (the medicine's own
      // generic_name + strength), so "Snip / Paracetamol 325mg" becomes the
      // first ingredient automatically.
      const initialIngredients: ActiveIngredient[] = [];
      if (isPharmacy && generic_name_raw) {
        initialIngredients.push({
          rowIndex: r + 1,
          ingredient_name: generic_name_raw,
          strength: strength,
        });
      }

      out.push({
        rowIndex: r + 1,
        raw: Object.fromEntries(headerRow.map((h, i) => [h, cells[i] ?? ''])),
        errors: rowErrors,
        isDuplicate,
        name,
        generic_name,
        category,
        manufacturer,
        batch_number,
        item_type,
        unit_label,
        packaging_mode,
        strips_per_pack,
        units_per_strip,
        units_per_pack,
        purchase_price: isNaN(purchase_price) ? 0 : purchase_price,
        selling_price: isNaN(selling_price) ? 0 : selling_price,
        stock_quantity: isNaN(stock_quantity) ? 0 : stock_quantity,
        minimum_stock_level: isNaN(minimum_stock_level) ? 0 : minimum_stock_level,
        expiry_date,
        medicine_group,
        strength,
        active_ingredients: initialIngredients,
      });
    }

    return { ok: out, errs };
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedBranchId) {
      toast({ title: 'Select a branch', description: 'Please choose a branch before uploading.', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const { ok, errs } = await validateAndNormalize(rows);
      setParsedRows(ok);
      setParseErrors(errs);
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to read CSV', variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const rowsWithErrors = parsedRows.filter(r => r.errors.length > 0);
  const duplicates = parsedRows.filter(r => r.isDuplicate && r.errors.length === 0);
  const cleanRows = parsedRows.filter(r => r.errors.length === 0);
  const canImport = parseErrors.length === 0 && rowsWithErrors.length === 0 && cleanRows.length > 0;

  const handleImport = async () => {
    if (!canImport) return;
    if (!selectedBranchId) {
      toast({ title: 'Error', description: 'Select a branch first', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    setStep('importing');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ownerId = profile?.role === 'owner' ? profile.id :
        (await supabase.from('pharmacy_branches').select('pharmacy_owner_id').eq('id', selectedBranchId).single()).data?.pharmacy_owner_id;

      // Resolve / create owner group for catalog linkage
      let groupId: string | null = null;
      if (ownerId) {
        const { data: og } = await supabase.from('owner_item_groups').select('group_id').eq('owner_id', ownerId).limit(1);
        if (og && og.length > 0) {
          groupId = og[0].group_id;
        } else {
          const { data: newGroup } = await supabase.from('grouped_items')
            .insert({ name: 'Imported Items', business_type: isPharmacy ? 'pharmacy' : 'general' })
            .select('id').single();
          if (newGroup) {
            groupId = newGroup.id;
            await supabase.from('owner_item_groups').insert({ owner_id: ownerId, group_id: groupId });
          }
        }
      }

      const toImport = cleanRows.filter(r => !(r.isDuplicate && duplicateAction === 'skip'));

      let success = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const row of toImport) {
        try {
          let medicineId: string | null = null;

          // Try reuse existing medicine if duplicate + create_new=false (skip path already filtered)
          if (row.isDuplicate && duplicateAction === 'skip') continue;

          // Always create a new medicine row (catalog entry) for clean imports.
          const medPayload: any = {
            name: row.name,
            generic_name: row.generic_name,
            category: row.category,
            manufacturer: row.manufacturer,
            batch_number: row.batch_number,
            item_type: row.item_type,
            unit_label: row.unit_label,
            units_per_pack: row.units_per_pack,
            minimum_stock_level: row.minimum_stock_level,
            purchase_price: row.purchase_price,
            selling_price: row.selling_price,
            stock_quantity: 0,
          };
          if (row.packaging_mode === 'with_strip') {
            medPayload.strips_per_pack = row.strips_per_pack;
            medPayload.units_per_strip = row.units_per_strip;
          }
          if (isPharmacy) {
            medPayload.medicine_group = row.medicine_group;
            medPayload.strength = row.strength;
          }

          const { data: newMed, error: medErr } = await supabase
            .from('medicines')
            .insert(medPayload)
            .select('id')
            .single();
          if (medErr) throw medErr;
          medicineId = newMed.id;

          // Link to owner's catalog group
          if (groupId && medicineId) {
            await supabase.from('grouped_item_members').insert({ group_id: groupId, medicine_id: medicineId });
          }

          // Persist active ingredients (pharmacy hierarchical composition)
          if (isPharmacy && medicineId && row.active_ingredients.length > 0) {
            const ingredientRows = row.active_ingredients.map((ing, i) => ({
              medicine_id: medicineId,
              ingredient_name: ing.ingredient_name,
              strength: ing.strength,
              sort_order: i,
            }));
            await (supabase as any).from('medicine_active_ingredients').insert(ingredientRows);
          }

          // Create branch_item
          const { data: newBI, error: biErr } = await supabase.from('branch_items').insert({
            owner_id: ownerId,
            branch_id: selectedBranchId,
            medicine_id: medicineId,
            selling_price: row.selling_price,
            purchase_price: row.purchase_price,
            quantity: row.stock_quantity,
            expiry_date: row.expiry_date,
          }).select('id').single();
          if (biErr) throw biErr;

          // Create initial inventory batch (so FIFO works)
          if (row.stock_quantity > 0) {
            const { error: batchErr } = await createBatch({
              branchId: selectedBranchId,
              medicineId,
              branchItemId: newBI.id,
              batchNumber: row.batch_number,
              quantity: row.stock_quantity,
              purchasePrice: row.purchase_price,
              sellingPrice: row.selling_price,
              expiryDate: row.expiry_date,
              createdBy: user?.id || null,
            });
            if (batchErr) throw batchErr;
          }

          success++;
        } catch (e: any) {
          failed++;
          failures.push(`Row ${row.rowIndex} (${row.name}): ${e.message || 'unknown error'}`);
        }
      }

      if (failed === 0) {
        toast({ title: 'Import complete', description: `${success} item(s) imported successfully.` });
      } else {
        toast({
          title: 'Import finished with errors',
          description: `${success} succeeded, ${failed} failed. ${failures.slice(0, 2).join(' • ')}`,
          variant: 'destructive',
        });
      }
      onImported();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message || 'Unknown error', variant: 'destructive' });
      setStep('preview');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import {isPharmacy ? 'Medicines' : 'Items'} from CSV
          </DialogTitle>
          <DialogDescription>
            Download the template, fill it with your items, then upload to bulk-create inventory.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            {profile?.role === 'owner' && branches.length > 0 && (
              <div className="space-y-2">
                <Label>Target Branch *</Label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <p><strong>Required columns:</strong> name, category, item_type, purchase_price, selling_price, stock_quantity.</p>
                <p><strong>item_type:</strong> <code>full_pcs</code> or <code>measurable</code>.</p>
                <p><strong>packaging_mode:</strong> <code>no_strip</code> or <code>with_strip</code>. If <code>with_strip</code>, fill <code>strips_per_pack</code> and <code>units_per_strip</code>.</p>
                <p><strong>Measurable units:</strong> {MEASURABLE_UNITS.join(', ')}. Date format: YYYY-MM-DD.</p>
                {isPharmacy && (
                  <p className="pt-1 border-t mt-1"><strong>💊 Pharmacy composition:</strong> Leave <code>name</code> empty on a row to add it as an <em>active ingredient</em> of the medicine on the row above. Use <code>generic_name</code> + <code>strength</code> for each ingredient. See template for example (Snip → Paracetamol + Pseudoephedrine + Chlorophenaramine).</p>
                )}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleDownloadTemplate} className="h-auto py-4 flex-col gap-2">
                <Download className="h-5 w-5" />
                <span className="font-medium">Download Template</span>
                <span className="text-xs text-muted-foreground">CSV with sample rows</span>
              </Button>

              <label className="cursor-pointer">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
                <Button
                  variant="default"
                  className="h-auto py-4 flex-col gap-2 w-full"
                  onClick={() => fileRef.current?.click()}
                  type="button"
                  disabled={!selectedBranchId}
                >
                  <Upload className="h-5 w-5" />
                  <span className="font-medium">Upload CSV</span>
                  <span className="text-xs opacity-80">{selectedBranchId ? 'Choose file…' : 'Select branch first'}</span>
                </Button>
              </label>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            {parseErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-1">File-level errors:</p>
                  <ul className="list-disc pl-4 text-xs">
                    {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold">{parsedRows.length}</div>
                <div className="text-xs text-muted-foreground">Total rows</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-destructive">{rowsWithErrors.length}</div>
                <div className="text-xs text-muted-foreground">Invalid</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-warning">{duplicates.length}</div>
                <div className="text-xs text-muted-foreground">Duplicates</div>
              </div>
            </div>

            {rowsWithErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-1">Fix these errors before importing — the entire file will be rejected:</p>
                  <ul className="list-disc pl-4 text-xs max-h-40 overflow-y-auto space-y-1">
                    {rowsWithErrors.slice(0, 20).map(r => (
                      <li key={r.rowIndex}>
                        <strong>Row {r.rowIndex}</strong> ({r.name || '(no name)'}): {r.errors.join('; ')}
                      </li>
                    ))}
                    {rowsWithErrors.length > 20 && <li>…and {rowsWithErrors.length - 20} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {duplicates.length > 0 && rowsWithErrors.length === 0 && (
              <div className="space-y-2 rounded-lg border p-3 bg-warning/5">
                <p className="text-sm font-medium">⚠️ {duplicates.length} item(s) match existing catalog entries (same name + manufacturer):</p>
                <ul className="text-xs text-muted-foreground list-disc pl-4 max-h-24 overflow-y-auto">
                  {duplicates.slice(0, 8).map(d => <li key={d.rowIndex}>Row {d.rowIndex}: {d.name} {d.manufacturer ? `(${d.manufacturer})` : ''}</li>)}
                  {duplicates.length > 8 && <li>…and {duplicates.length - 8} more</li>}
                </ul>
                <div className="space-y-2 pt-1">
                  <Label className="text-xs">How to handle duplicates?</Label>
                  <Select value={duplicateAction} onValueChange={v => setDuplicateAction(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip duplicates (recommended)</SelectItem>
                      <SelectItem value="create_new">Create as new catalog entries anyway</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {canImport && rowsWithErrors.length === 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Ready to import <strong>{cleanRows.length - (duplicateAction === 'skip' ? duplicates.length : 0)}</strong> item(s) into the selected branch.
                </AlertDescription>
              </Alert>
            )}

            {parsedRows.length > 0 && (
              <div className="border rounded-lg overflow-x-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Row</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Stock</th>
                      <th className="text-left p-2">Cost / Sell</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 50).map(r => (
                      <tr key={r.rowIndex} className="border-t">
                        <td className="p-2">{r.rowIndex}</td>
                        <td className="p-2">{r.name || <span className="text-destructive">—</span>}</td>
                        <td className="p-2">{r.item_type}{r.packaging_mode === 'with_strip' && ' (strip)'}</td>
                        <td className="p-2">{r.stock_quantity} {r.unit_label}</td>
                        <td className="p-2">{r.purchase_price} / {r.selling_price}</td>
                        <td className="p-2">
                          {r.errors.length > 0
                            ? <Badge variant="destructive" className="text-[10px]">Invalid</Badge>
                            : r.isDuplicate
                              ? <Badge variant="outline" className="text-[10px] border-warning text-warning">Duplicate</Badge>
                              : <Badge variant="outline" className="text-[10px] border-green-600 text-green-600">OK</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">…and {parsedRows.length - 50} more rows</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('upload')}>Upload Different File</Button>
              <Button onClick={handleImport} disabled={!canImport || submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Import {cleanRows.length - (duplicateAction === 'skip' ? duplicates.length : 0)} item(s)
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importing items, please wait…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
