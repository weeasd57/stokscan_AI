import type { Metadata } from "next";
import AdminAuthGuard from "./AdminAuthGuard";

export const metadata: Metadata = {
    title: "Admin Panel | EGX BOTS",
    robots: {
        index: false,
        follow: false,
    },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <AdminAuthGuard>{children}</AdminAuthGuard>;
}
