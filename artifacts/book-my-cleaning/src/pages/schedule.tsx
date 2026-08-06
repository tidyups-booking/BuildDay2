import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import {
  useGetSchedule,
  useGetCompany,
  getGetScheduleQueryKey,
  ScheduleJob,
  ScheduleCleaner,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { companyTimeZone, formatZoned, zoneLabel } from "@/lib/time";
import {
  todayInZone,
  shiftDay,
  sortJobsByTime,
  totalDurationMinutes,
  formatDuration,
  formatPrice,
} from "@/lib/schedule";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  MapPin,
  Clock,
  User,
  Users,
} from "lucide-react";

export function SchedulePage() {
  const { data: company } = useGetCompany();
  const timeZone = companyTimeZone(company);
  const [date, setDate] = useState(() => todayInZone(timeZone));

  const { data: schedule, isLoading } = useGetSchedule(
    { date },
    { query: { queryKey: getGetScheduleQueryKey({ date }) } },
  );

  const today = todayInZone(timeZone);
  const hasCleaners = (schedule?.cleaners.length ?? 0) > 0;
  const hasUnassigned = (schedule?.unassigned.length ?? 0) > 0;

  return (
    <AppLayout>
      <PageHeader
        title="Schedule"
        description={`Everyone's day, in ${zoneLabel(timeZone)} — the time your customers were quoted.`}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate((d) => shiftDay(d, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground"
            aria-label="Schedule date"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant={date === today ? "default" : "outline"}
            onClick={() => setDate(today)}
          >
            Today
          </Button>
        </div>
      </PageHeader>

      <PanelErrorBoundary label="schedule">
        {isLoading ? (
          <LoadingSpinner className="mt-20" />
        ) : !hasCleaners && !hasUnassigned ? (
          <div className="bg-card border border-border rounded-xl shadow-sm p-12 text-center">
            <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              Nobody scheduled for this day
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              There are no jobs on {formatDateHeading(date)}. Assign crews from
              the Bookings page and they&apos;ll show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {schedule!.cleaners.map((cleaner) => (
              <CleanerLane
                key={cleaner.teamMemberId}
                cleaner={cleaner}
                timeZone={timeZone}
              />
            ))}
            {hasUnassigned && (
              <UnassignedLane jobs={schedule!.unassigned} timeZone={timeZone} />
            )}
          </div>
        )}
      </PanelErrorBoundary>
    </AppLayout>
  );
}

function CleanerLane({
  cleaner,
  timeZone,
}: {
  cleaner: ScheduleCleaner;
  timeZone: string;
}) {
  const jobs = sortJobsByTime(cleaner.jobs);
  const total = totalDurationMinutes(cleaner.jobs);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {cleaner.name.charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-foreground truncate">
            {cleaner.name}
          </span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
          {total > 0 ? ` · ${formatDuration(total)}` : ""}
        </span>
      </div>
      <div className="p-3 space-y-3">
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No jobs booked.
          </p>
        ) : (
          jobs.map((job) => (
            <JobCard key={job.bookingId} job={job} timeZone={timeZone} />
          ))
        )}
      </div>
    </div>
  );
}

function UnassignedLane({
  jobs,
  timeZone,
}: {
  jobs: ScheduleJob[];
  timeZone: string;
}) {
  const sorted = sortJobsByTime(jobs);
  return (
    <div className="bg-card border border-amber-500/30 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-500/30 bg-amber-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-amber-300">Unassigned</span>
        </div>
        <span className="text-xs text-amber-300/80">
          {sorted.length} {sorted.length === 1 ? "job" : "jobs"}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <p className="text-xs text-amber-300/80 -mt-1">
          Nobody is on these yet — assign a crew from Bookings.
        </p>
        {sorted.map((job) => (
          <JobCard key={job.bookingId} job={job} timeZone={timeZone} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, timeZone }: { job: ScheduleJob; timeZone: string }) {
  const price = formatPrice(job.price);
  const duration = formatDuration(job.durationMinutes);
  return (
    <Link href={`/bookings#booking-${job.bookingId}`}>
      <div className="rounded-lg border border-border bg-background/40 p-3 hover:border-brand-pink/40 hover:bg-secondary/40 transition-colors cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Clock className="w-3.5 h-3.5 text-brand-pink shrink-0" />
            {formatZoned(job.scheduledFor, timeZone).replace(/^.*at\s/, "")}
          </div>
          <JobStatusBadge status={job.status} />
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex items-center gap-1.5 text-foreground">
            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{job.customerName}</span>
          </div>
          <div className="flex items-start gap-1.5 text-muted-foreground text-xs">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{job.customerAddress || "Address not provided"}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{duration || "—"}</span>
          {price && (
            <span className="font-semibold text-foreground tabular-nums">
              {price}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function JobStatusBadge({ status }: { status: ScheduleJob["status"] }) {
  const styles: Record<ScheduleJob["status"], string> = {
    pending: "bg-secondary text-muted-foreground border-border",
    confirmed: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    canceled: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] py-0 h-5 capitalize ${styles[status]}`}
    >
      {status}
    </Badge>
  );
}

function formatDateHeading(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, y, m, d] = match.map(Number) as unknown as number[];
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
