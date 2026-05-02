import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
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

// ---------------------------------------------------------------------------
// Real-world header aliases. Users upload sheets with messy / typo'd headers
// (CATAGORY, BACH NO, EX-DATE, "PERCHASING PRICE (strip)" ...). We normalize
// any column whose header — after lowercasing, stripping punctuation and
// collapsing whitespace — matches one of these aliases to our canonical key.
// ---------------------------------------------------------------------------
const HEADER_ALIASES: Record<string, string> = {
  // canonical
  name: 'name', 'name of items': 'name', 'item name': 'name', 'product name': 'name',
  generic_name: 'generic_name', 'generic name': 'generic_name', generic: 'generic_name',
  medicine_group: 'medicine_group', group: 'medicine_group', 'medicine group': 'medicine_group',
  strength: 'strength',
  category: 'category', catagory: 'category', cat: 'category',
  manufacturer: 'manufacturer', mfg: 'manufacturer', maker: 'manufacturer', brand: 'manufacturer',
  batch_number: 'batch_number', 'batch no': 'batch_number', 'bach no': 'batch_number', batch: 'batch_number', 'batch number': 'batch_number',
  item_type: 'item_type', 'item type': 'item_type', type: 'item_type',
  unit_label: 'unit_label', 'unit by label': 'unit_label', 'unit label': 'unit_label', unit: 'unit_label',
  packaging_mode: 'packaging_mode', 'packaging mode': 'packaging_mode', packaging: 'packaging_mode', pack: 'packaging_mode',
  strips_per_pack: 'strips_per_pack', 'strips per pack': 'strips_per_pack',
  units_per_strip: 'units_per_strip', 'units per strip': 'units_per_strip',
  units_per_pack: 'units_per_pack', 'units per pack': 'units_per_pack', 'unit per pack': 'units_per_pack',
  purchase_price: 'purchase_price', 'purchase price': 'purchase_price', 'perchasing price': 'purchase_price',
  'perchasing price strip': 'purchase_price', 'purchase price strip': 'purchase_price',
  'cost price': 'purchase_price', cost: 'purchase_price',
  selling_price: 'selling_price', 'selling price': 'selling_price', 'selling price strip': 'selling_price',
  price: 'selling_price', sale: 'selling_price', 'sale price': 'selling_price',
  stock_quantity: 'stock_quantity', 'stock quantity': 'stock_quantity', quantity: 'stock_quantity',
  'quantity pk': 'stock_quantity', qty: 'stock_quantity', stock: 'stock_quantity',
  minimum_stock_level: 'minimum_stock_level', 'minimum stock level': 'minimum_stock_level',
  'min stock': 'minimum_stock_level', 'minimum stock': 'minimum_stock_level', 'reorder level': 'minimum_stock_level',
  expiry_date: 'expiry_date', 'expiry date': 'expiry_date', 'ex date': 'expiry_date', 'exp date': 'expiry_date',
  expiry: 'expiry_date', expiration: 'expiry_date',
};

function normalizeHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .replace(/[()._\-\/\\*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalHeader(h: string): string | null {
  const n = normalizeHeader(h);
  if (!n) return null;
  if (HEADER_ALIASES[n]) return HEADER_ALIASES[n];
  // Fallback: try removing trailing words like "strip", "pk"
  const stripped = n.replace(/\s+(strip|pk|pack)$/g, '').trim();
  return HEADER_ALIASES[stripped] || null;
}

// Parse a "PACKAGING MODE" cell like "3*10", "3x10", "3×10", "1*1", "30g", "100ml".
// Returns { stripsPerPack, unitsPerStrip } if it looks like a strip layout.
function parsePackagingMode(s: string): { stripsPerPack: number | null; unitsPerStrip: number | null; isStripLayout: boolean } {
  if (!s) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  const m = s.trim().match(/^(\d+)\s*[x*×]\s*(\d+)$/i);
  if (!m) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  const a = parseInt(m[1]);
  const b = parseInt(m[2]);
  // Treat 1*1 as "no real strip layout"
  if (a === 1 && b === 1) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  return { stripsPerPack: a, unitsPerStrip: b, isStripLayout: true };
}

// "1 PK", "3 tubes", "5 vials", "2pk" → 1, 3, 5, 2
function parseLeadingInt(s: string): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : Math.round(v);
}

// Strength may be a percentage stored as a number (0.0116 → "1.16%"), a date
// (2/30/2027 — invalid date), or a normal string like "500mg".
function normalizeStrength(raw: any): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    // Treat numbers <=1 as fraction → percentage
    if (raw > 0 && raw <= 1) return `${+(raw * 100).toFixed(2)}%`;
    return String(raw);
  }
  return String(raw).trim() || null;
}

// Robust date parser: handles ISO (2026-07-26), DMY (30/10/2027), MDY (10/30/2027),
// and Excel Date objects. Returns YYYY-MM-DD or null on invalid (incl. 2/30/...).
function parseExpiryDate(raw: any): { iso: string | null; valid: boolean; hadValue: boolean } {
  if (raw == null || raw === '') return { iso: null, valid: true, hadValue: false };
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return { iso: null, valid: false, hadValue: true };
    return { iso: raw.toISOString().slice(0, 10), valid: true, hadValue: true };
  }
  const s = String(raw).trim();
  if (!s) return { iso: null, valid: true, hadValue: false };
  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return validateDate(+y, +mo, +d);
  }
  // d/m/y or m/d/y or d-m-y
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    let yr = +y;
    if (yr < 100) yr += 2000;
    const ai = +a, bi = +b;
    // Prefer DMY when first part > 12 (unambiguous), else try DMY first then MDY
    if (ai > 12) return validateDate(yr, bi, ai);
    if (bi > 12) return validateDate(yr, ai, bi);
    // Ambiguous: try DMY (matches the user's sheet locale: 30/10/2027)
    const dmy = validateDate(yr, bi, ai);
    if (dmy.valid) return dmy;
    return validateDate(yr, ai, bi);
  }
  // Last resort: native Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), valid: true, hadValue: true };
  return { iso: null, valid: false, hadValue: true };
}

function validateDate(y: number, mo: number, d: number): { iso: string | null; valid: boolean; hadValue: boolean } {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { iso: null, valid: false, hadValue: true };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { iso: null, valid: false, hadValue: true };
  }
  return { iso: dt.toISOString().slice(0, 10), valid: true, hadValue: true };
}

// Map freetext item type ("Tablet", "GEL", "INJECTION", "powder", "suspension")
// to our schema's full_pcs / measurable. Liquids/creams/gels = measurable.
function inferItemType(itemTypeText: string, unitLabel: string): 'full_pcs' | 'measurable' {
  const t = (itemTypeText + ' ' + unitLabel).toLowerCase();
  if (/(gel|cream|ointment|syrup|suspension|drop|spray|lotion|powder|liquid|tube|bottle|ml|gram|\bg\b|kg)/.test(t)) {
    // Tubes & bottles in this catalog still ship as discrete units → keep full_pcs
    if (/(tube|bottle|sachet|vial|ampoule|amp)/.test(t) && !/(ml|gram|\bg\b|kg)/.test(t)) {
      return 'full_pcs';
    }
    if (/(ml|gram|\bg\b|kg|liquid|powder)/.test(t)) return 'measurable';
  }
  return 'full_pcs';
}

function inferUnitLabel(itemType: 'full_pcs' | 'measurable', rawUnit: string, packagingText: string): string {
  const u = (rawUnit || '').toLowerCase().trim();
  if (itemType === 'measurable') {
    if (/ml/.test(packagingText)) return 'ml';
    if (/(g|gram)/.test(packagingText)) return 'g';
    if (MEASURABLE_UNITS.includes(u as any)) return u;
    return 'g';
  }
  // full_pcs
  if (!u) return 'piece';
  if (u === 'pk') return 'pack';
  if (u === 'tube') return 'tube';
  if (u === 'vial') return 'vial';
  if (u === 'bottle') return 'bottle';
  if (u === 'sachet') return 'sachet';
  if (u === 'strip') return 'strip';
  return u;
}

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

  const validateAndNormalize = async (rows: any[][]): Promise<{ ok: ParsedRow[]; errs: string[] }> => {
    const errs: string[] = [];
    if (rows.length < 2) {
      return { ok: [], errs: ['File is empty or has no data rows.'] };
    }

    // Build header → canonical-key map by alias matching. Unknown columns are ignored.
    const rawHeaders = rows[0].map((h: any) => String(h ?? ''));
    const headerToKey: Record<number, string> = {};
    rawHeaders.forEach((h, i) => {
      const k = canonicalHeader(h);
      if (k) headerToKey[i] = k;
    });
    const keyIndex: Record<string, number> = {};
    Object.entries(headerToKey).forEach(([i, k]) => {
      if (keyIndex[k] === undefined) keyIndex[k] = +i;
    });

    // Required columns
    const required = ['name', 'purchase_price', 'selling_price', 'stock_quantity'];
    const missingReq = required.filter(k => keyIndex[k] === undefined);
    if (missingReq.length > 0) {
      return { ok: [], errs: [`Missing required column(s): ${missingReq.join(', ')}. Recognized headers: ${Object.values(headerToKey).join(', ') || '(none)'}.`] };
    }
    const get = (cells: any[], k: string): string => {
      const i = keyIndex[k];
      if (i === undefined) return '';
      const v = cells[i];
      if (v == null) return '';
      return String(v).trim();
    };
    const getRaw = (cells: any[], k: string): any => {
      const i = keyIndex[k];
      return i === undefined ? '' : cells[i];
    };

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
    let groupCarry: string | null = null; // GROUP cell only filled on first row of a group

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r] || [];
      if (!cells.some((c: any) => c != null && String(c).trim() !== '')) continue; // blank row
      const rowErrors: string[] = [];

      const name = get(cells, 'name');
      const generic_name_raw = get(cells, 'generic_name');
      const groupCell = get(cells, 'medicine_group');
      if (groupCell) groupCarry = groupCell;

      // Pharmacy hierarchy: empty NAME but ingredient continuation
      if (isPharmacy && !name) {
        if (!generic_name_raw) continue; // truly blank
        const parent = out[out.length - 1];
        if (!parent) {
          errs.push(`Row ${r + 1}: ingredient row "${generic_name_raw}" has no parent medicine above it.`);
          continue;
        }
        parent.active_ingredients.push({
          rowIndex: r + 1,
          ingredient_name: generic_name_raw,
          strength: normalizeStrength(getRaw(cells, 'strength')),
        });
        continue;
      }

      if (!name) rowErrors.push('column "NAME OF ITEMS" is empty (required)');

      const itemTypeRaw = get(cells, 'item_type');
      const unitLabelRaw = get(cells, 'unit_label');
      const packagingRaw = get(cells, 'packaging_mode');

      const item_type: 'full_pcs' | 'measurable' = (() => {
        const v = itemTypeRaw.toLowerCase();
        if (v === 'measurable' || v === 'full_pcs') return v as any;
        return inferItemType(itemTypeRaw, unitLabelRaw);
      })();
      const unit_label = inferUnitLabel(item_type, unitLabelRaw, packagingRaw);
      if (item_type === 'measurable' && !MEASURABLE_UNITS.includes(unit_label as any)) {
        rowErrors.push(`unit_label "${unit_label}" must be one of: ${MEASURABLE_UNITS.join(', ')}`);
      }

      // Packaging: accept canonical (with_strip/no_strip) OR real-world like "3*10".
      let packaging_mode: 'with_strip' | 'no_strip' = 'no_strip';
      let strips_per_pack: number | null = null;
      let units_per_strip: number | null = null;
      let units_per_pack: number | null = null;

      if (packagingRaw === 'with_strip' || packagingRaw === 'no_strip') {
        packaging_mode = packagingRaw;
      } else {
        const parsed = parsePackagingMode(packagingRaw);
        if (parsed.isStripLayout) {
          packaging_mode = 'with_strip';
          strips_per_pack = parsed.stripsPerPack;
          units_per_strip = parsed.unitsPerStrip;
          units_per_pack = (parsed.stripsPerPack || 0) * (parsed.unitsPerStrip || 0);
        }
      }

      // Allow explicit columns to override / fill in
      if (item_type === 'full_pcs' && packaging_mode === 'with_strip') {
        const sp = parseInt(get(cells, 'strips_per_pack')) || strips_per_pack;
        const ups = parseInt(get(cells, 'units_per_strip')) || units_per_strip;
        if (!sp || sp < 1) rowErrors.push('strips_per_pack must be ≥ 1 when packaging is strip layout');
        if (!ups || ups < 1) rowErrors.push('units_per_strip must be ≥ 1 when packaging is strip layout');
        if (sp && ups) {
          strips_per_pack = sp;
          units_per_strip = ups;
          units_per_pack = sp * ups;
        }
      } else {
        const upp = get(cells, 'units_per_pack');
        if (upp) {
          const v = parseInt(upp);
          if (!isNaN(v) && v >= 1) units_per_pack = v;
        }
      }

      const purchaseRaw = get(cells, 'purchase_price');
      const sellingRaw = get(cells, 'selling_price');
      let purchase_price = parseFloat(purchaseRaw);
      let selling_price = parseFloat(sellingRaw);
      if (!purchaseRaw || isNaN(purchase_price) || purchase_price < 0) rowErrors.push('purchase_price is required and must be ≥ 0');
      if (!sellingRaw || isNaN(selling_price) || selling_price < 0) rowErrors.push('selling_price is required and must be ≥ 0');

      // Per-strip → per-pack conversion (user choice: prices labeled "(strip)" → multiply by strips_per_pack)
      if (packaging_mode === 'with_strip' && strips_per_pack && strips_per_pack > 1) {
        if (!isNaN(purchase_price)) purchase_price = +(purchase_price * strips_per_pack).toFixed(2);
        if (!isNaN(selling_price)) selling_price = +(selling_price * strips_per_pack).toFixed(2);
      }

      const stockRaw = get(cells, 'stock_quantity');
      const stock_quantity = item_type === 'measurable' ? parseFloat(stockRaw) : parseInt(stockRaw);
      if (!stockRaw || isNaN(stock_quantity) || stock_quantity < 0) rowErrors.push('stock_quantity is required and must be ≥ 0');

      const minRaw = get(cells, 'minimum_stock_level');
      // accept "1 PK", "3 tubes" etc.
      const minimum_stock_level = minRaw ? (parseLeadingInt(minRaw) ?? 0) : 0;

      const expRaw = getRaw(cells, 'expiry_date');
      const expParsed = parseExpiryDate(expRaw);
      if (expParsed.hadValue && !expParsed.valid) {
        rowErrors.push(`expiry_date "${String(expRaw)}" is not a valid date`);
      }
      const expiry_date = expParsed.iso;

      const generic_name = generic_name_raw || null;
      const manufacturer = get(cells, 'manufacturer') || null;
      const batch_number = get(cells, 'batch_number') || null;
      const category = get(cells, 'category') || (isPharmacy ? 'tablet' : 'other');
      const medicine_group = isPharmacy ? (groupCell || groupCarry || null) : null;
      const strength = isPharmacy ? normalizeStrength(getRaw(cells, 'strength')) : null;

      const key = `${name.toLowerCase()}|${(manufacturer || '').toLowerCase()}`;
      if (seenInFile.has(key)) rowErrors.push('Duplicate row in file (same name + manufacturer)');
      seenInFile.add(key);
      const isDuplicate = name ? existingKey.has(key) : false;

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
        raw: Object.fromEntries(rawHeaders.map((h, i) => [String(h), cells[i] != null ? String(cells[i]) : ''])),
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
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      let rows: any[][];
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: '' });
      } else {
        const text = await file.text();
        rows = parseCsv(text);
      }
      const { ok, errs } = await validateAndNormalize(rows);
      setParsedRows(ok);
      setParseErrors(errs);
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to read file', variant: 'destructive' });
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
            Import {isPharmacy ? 'Medicines' : 'Items'} from CSV / Excel
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
                <p><strong>Accepted files:</strong> .csv, .xlsx, .xls. Real-world headers like <code>NAME OF ITEMS</code>, <code>CATAGORY</code>, <code>BACH NO</code>, <code>EX-DATE</code>, <code>PERCHASING PRICE (strip)</code>, <code>QUANTITY (PK)</code> are auto-detected.</p>
                <p><strong>Required:</strong> name, purchase_price, selling_price, stock_quantity.</p>
                <p><strong>Packaging:</strong> use <code>3*10</code> / <code>6*10</code> for strip layouts (auto-converted). Prices in <em>per-strip</em> are auto-multiplied to per-pack.</p>
                {isPharmacy && (
                  <>
                    <p className="pt-1 border-t mt-1"><strong>💊 GROUP inheritance:</strong> Fill <code>GROUP</code> only on the first item of a group; subsequent rows inherit it until the next group.</p>
                    <p><strong>💊 Composition:</strong> Leave <code>NAME OF ITEMS</code> empty on a row to add it as an <em>active ingredient</em> of the medicine above (just fill GENERIC NAME + STRENGTH).</p>
                  </>
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
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                  <span className="font-medium">Upload CSV / Excel</span>
                  <span className="text-xs opacity-80">{selectedBranchId ? 'Choose .csv, .xlsx or .xls…' : 'Select branch first'}</span>
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
                        <td className="p-2">
                          {r.name || <span className="text-destructive">—</span>}
                          {isPharmacy && r.active_ingredients.length > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Contains: {r.active_ingredients.map(i => i.ingredient_name + (i.strength ? ` ${i.strength}` : '')).join(' + ')}
                            </div>
                          )}
                        </td>
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
