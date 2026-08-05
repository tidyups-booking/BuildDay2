import { useGetDashboardSummary, useGetRecentActivity, ActivityItem, useGetCompany } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import { PhoneIncoming, CalendarCheck, Clock, TrendingUp, PhoneMissed, CheckCircle2, UserPlus, PhoneForwarded, AlertCircle } from "lucide-react";
import { format } from "date-fns";

export function DashboardPage() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: isActivityLoading } = useGetRecentActivity();
  const { data: company } = useGetCompany();

  if (isSummaryLoading || isActivityLoading) {
    return (
      <AppLayout>
        <LoadingSpinner className="mt-20" />
      </AppLayout>
    );
  }

  const statCards = summary ? [
    { label: "Calls Today", value: summary.callsToday, icon: PhoneIncoming, color: "text-blue-600", bg: "bg-brand-purple/20" },
    { label: "Answered Rate", value: `${Math.round(summary.answeredRate * 100)}%`, icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/100/10" },
    { label: "Bookings This Week", value: summary.bookingsThisWeek, icon: CalendarCheck, color: "text-indigo-600", bg: "bg-indigo-100" },
    { label: "Avg Call Length", value: `${Math.round(summary.avgCallSeconds / 60)}m ${summary.avgCallSeconds % 60}s`, icon: Clock, color: "text-orange-600", bg: "bg-orange-100" },
  ] : [];

  return (
    <AppLayout>
      <PageHeader 
        title="Dashboard" 
        description={company?.isLive ? "Your AI receptionist is live and monitoring calls." : "Complete setup to take your AI receptionist live."} 
      />

      {company && !company.isLive && (
        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-amber-600 font-bold">!</span>
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">Finish your setup</h3>
            <p className="text-sm text-amber-800 mt-1 mb-3">Your AI receptionist is not answering calls yet. Complete the onboarding checklist to go live.</p>
            <a href="/setup" className="text-sm font-medium text-amber-700 bg-card border border-amber-300 px-3 py-1.5 rounded shadow-sm hover:bg-amber-50">
              Resume Setup
            </a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.bg}`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div className="text-sm font-medium text-muted-foreground">{stat.label}</div>
              </div>
              <div className="text-3xl font-serif font-bold text-muted-foreground">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-secondary/50">
          <h2 className="font-semibold text-muted-foreground">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {activity?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No recent activity. Once your AI starts taking calls, they will appear here.
            </div>
          ) : (
            activity?.map((item: ActivityItem) => (
              <div key={item.id} className="p-4 px-6 flex items-start gap-4 hover:bg-secondary transition-colors">
                <ActivityIcon type={item.type} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{item.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{format(new Date(item.occurredAt), "MMM d, h:mm a")}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function ActivityIcon({ type }: { type: ActivityItem["type"] }) {
  switch (type) {
    case "call_answered":
      return <div className="w-8 h-8 rounded-full bg-brand-purple/20 flex items-center justify-center shrink-0"><PhoneForwarded className="w-4 h-4 text-blue-600" /></div>;
    case "booking_created":
      return <div className="w-8 h-8 rounded-full bg-green-500/100/10 flex items-center justify-center shrink-0"><CalendarCheck className="w-4 h-4 text-green-400" /></div>;
    case "jobber_synced":
      return <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0"><CheckCircle2 className="w-4 h-4 text-indigo-600" /></div>;
    case "jobber_sync_failed":
      return <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0"><AlertCircle className="w-4 h-4 text-red-400" /></div>;
    case "team_invited":
      return <div className="w-8 h-8 rounded-full bg-brand-purple/10 flex items-center justify-center shrink-0"><UserPlus className="w-4 h-4 text-brand-purple" /></div>;
    case "test_call":
      return <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0"><PhoneIncoming className="w-4 h-4 text-muted-foreground" /></div>;
    default:
      return <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0"><div className="w-2 h-2 rounded-full bg-secondary" /></div>;
  }
}
