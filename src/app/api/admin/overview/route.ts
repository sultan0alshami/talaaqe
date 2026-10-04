// Only this canonical metadata read is activated. Other legacy admin routes
// continue through their guarded retirement handler.
export { loadAdminOverview as GET } from "@/lib/admin/transport";
