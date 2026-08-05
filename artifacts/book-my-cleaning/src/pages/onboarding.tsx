import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useCreateCompany,
  useUpdateCompany,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Building2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { runOnboardingSubmit } from "@/lib/onboardingSubmit";

const formSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
  notificationNumber: z
    .string()
    .refine((v) => v.trim() === "" || /^[+()\-.\s\d]{7,20}$/.test(v.trim()), {
      message: "Enter a valid phone number, or leave it blank",
    }),
});

export function OnboardingPage() {
  const [, setLocation] = useLocation();
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", notificationNumber: "" },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    // The browser already knows the owner's time zone — send it so new
    // companies don't all start on the default zone. If detection fails,
    // omit it and let the server default apply.
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      timezone = undefined;
    }
    // Create, then save the number via the existing update endpoint so
    // brand-new companies have an outage-text number on file from day one.
    // If the number save fails, stay here and say so — silently dropping the
    // number the owner just typed would defeat the point of collecting it.
    // Re-submitting is safe: company creation is idempotent server-side.
    runOnboardingSubmit({
      createCompany: () =>
        createCompany.mutateAsync({
          data: { name: values.name, ...(timezone ? { timezone } : {}) },
        }),
      saveNotificationNumber: (notificationNumber) =>
        updateCompany.mutateAsync({ data: { notificationNumber } }),
      notificationNumber: values.notificationNumber,
    })
      .then((result) => {
        if (result.outcome === "done") {
          setLocation("/setup");
        } else {
          const error = result.error as any;
          toast({
            title: "Couldn't save your notification number",
            description:
              (error?.message ||
                "Your workspace was created, but the number wasn't saved.") +
              " Press Continue to try again, or clear the field to skip for now.",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        // Create failed — the mutation's own error state covers messaging.
      });
  }

  return (
    <div className="min-h-screen bg-secondary flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-96 bg-primary/5 -skew-y-6 origin-top-left pointer-events-none" />

      <div className="w-full max-w-md bg-card rounded-2xl shadow-xl border border-border p-8 relative z-10">
        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
          <Building2 className="w-6 h-6 text-primary" />
        </div>

        <h1 className="text-2xl font-serif font-bold text-muted-foreground mb-2">
          Welcome to Tidyups
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Let's set up your AI receptionist workspace. What's your cleaning
          company called?
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Sparkle Cleaners"
                      className="h-12"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notificationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Notification Number{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional, recommended)
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="e.g. 555-123-4567"
                      className="h-12"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-sm text-muted-foreground">
                    We'll text this number if your phone connection ever breaks
                    or recovers. You can change it later in Settings.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full h-12 text-base gap-2"
              disabled={createCompany.isPending || updateCompany.isPending}
            >
              {createCompany.isPending || updateCompany.isPending
                ? "Creating..."
                : "Continue to Setup"}
              {!(createCompany.isPending || updateCompany.isPending) && (
                <ArrowRight className="w-4 h-4" />
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
