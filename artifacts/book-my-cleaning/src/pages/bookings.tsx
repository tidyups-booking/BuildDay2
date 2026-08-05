import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import { useListBookings, useUpdateBooking, useSyncBookingToJobber, getListBookingsQueryKey, Booking } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Calendar, MapPin, Phone, User, CheckCircle2, MoreHorizontal, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export function BookingsPage() {
  const { data: bookings, isLoading } = useListBookings();
  const updateBooking = useUpdateBooking();
  const syncJobber = useSyncBookingToJobber();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (id: number, status: 'pending' | 'confirmed' | 'completed' | 'canceled') => {
    updateBooking.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Status updated", description: `Booking marked as ${status}.` });
      }
    });
  };

  const handleSync = (id: number) => {
    syncJobber.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Synced to Jobber", description: "Job created in your Jobber account." });
      }
    });
  };

  return (
    <AppLayout>
      <PageHeader 
        title="Bookings" 
        description="Jobs booked directly from AI receptionist calls."
      />

      {isLoading ? (
        <LoadingSpinner className="mt-20" />
      ) : !bookings || bookings.length === 0 ? (
        <div className="bg-card border border-border rounded-xl shadow-sm p-12 text-center">
          <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-muted-foreground mb-1">No bookings yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">When your AI receptionist successfully books a customer, it will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bookings.map((booking: Booking) => (
            <div key={booking.id} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-muted-foreground">{booking.customerName}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <BookingStatusBadge status={booking.status} />
                    {booking.jobberSynced && (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-200">
                        <CheckCircle2 className="w-3 h-3" /> Jobber
                      </span>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-muted-foreground">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleStatusChange(booking.id, 'confirmed')}>Mark Confirmed</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange(booking.id, 'completed')}>Mark Completed</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange(booking.id, 'canceled')} className="text-red-400">Cancel Booking</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground flex-1">
                <div className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span>{format(new Date(booking.scheduledFor), "EEEE, MMMM d, yyyy 'at' h:mm a")}</span>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span>{booking.customerAddress || "Address not provided"}</span>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span>{booking.customerPhone}</span>
                </div>
                <div className="flex items-start gap-3">
                  <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="font-medium text-muted-foreground">Requested: {booking.service}</span>
                </div>
              </div>

              {!booking.jobberSynced && (
                <div className="mt-5 pt-4 border-t border-border">
                  <Button 
                    variant="outline" 
                    className="w-full text-primary hover:text-primary hover:bg-primary/5 border-primary/20 gap-2"
                    onClick={() => handleSync(booking.id)}
                    disabled={syncJobber.isPending}
                  >
                    <RefreshCw className={`w-4 h-4 ${syncJobber.isPending ? "animate-spin" : ""}`} />
                    {syncJobber.isPending ? "Syncing..." : "Sync to Jobber"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

function BookingStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-0">Pending</Badge>;
    case 'confirmed': return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-0">Confirmed</Badge>;
    case 'completed': return <Badge className="bg-green-500/100/10 text-green-700 hover:bg-green-200 border-0">Completed</Badge>;
    case 'canceled': return <Badge className="bg-secondary text-muted-foreground hover:bg-secondary border-0">Canceled</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}
