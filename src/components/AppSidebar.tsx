import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  DollarSign, 
  Truck, 
  Users,
  Settings
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

const ownerNavItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Sales", url: "/sales", icon: ShoppingCart },
  { title: "Finance", url: "/finance", icon: DollarSign },
  { title: "Suppliers", url: "/suppliers", icon: Truck },
  { title: "Staff", url: "/staff", icon: Users },
  { title: "Account", url: "/account", icon: Settings },
];

const staffNavItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Sales", url: "/sales", icon: ShoppingCart },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Account", url: "/account", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const { profile } = useAuth();
  const currentPath = location.pathname;

  const navItems = profile?.role === 'owner' ? ownerNavItems : staffNavItems;
  const isCollapsed = state === "collapsed";

  const isActive = (path: string) => {
    if (path === "/") {
      return currentPath === "/" || currentPath === "";
    }
    return currentPath.startsWith(path);
  };

  const getNavCls = (path: string) =>
    isActive(path) 
      ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" 
      : "hover:bg-muted/50 text-muted-foreground hover:text-foreground";

  return (
    <Sidebar
      className={isCollapsed ? "w-14" : "w-64"}
      collapsible="icon"
    >
      <SidebarHeader className="border-b p-4 bg-[#4b9eab]">
        <div className="flex items-center space-x-2">
          <div className="flex items-center justify-center w-15 h-15 rounded-md overflow-hidden">
            <img src="/lovable-uploads/2f79a84c-a540-4f7f-bbe7-0bb88136976a.png" alt="PharmaXpert Logo" className="w-15 h-15 object-cover" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-lg font-bold">PharmaXpert</h1>
              {profile && (
                <Badge 
                  variant={profile.role === 'owner' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {profile.role === 'owner' ? 'Owner' : 'Staff'}
                </Badge>
              )}
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink 
                      to={item.url} 
                      end={item.url === "/"}
                      className={getNavCls(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}