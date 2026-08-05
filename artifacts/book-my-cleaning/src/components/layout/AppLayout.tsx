import { useGetCompany } from "@workspace/api-client-react";
import { Redirect, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: company, isLoading, error } = useGetCompany();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error && location !== "/onboarding") {
    return <Redirect to="/onboarding" />;
  }

  if (company && !company.setupStatus.accountCreated && location !== "/onboarding") {
    return <Redirect to="/onboarding" />;
  }

  if (location === "/onboarding") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar company={company} />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 md:p-8 lg:p-10 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
