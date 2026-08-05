import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateCompany } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Building2, ArrowRight } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
});

export function OnboardingPage() {
  const [, setLocation] = useLocation();
  const createCompany = useCreateCompany();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createCompany.mutate(
      { data: { name: values.name } },
      {
        onSuccess: () => {
          setLocation("/setup");
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-secondary flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-96 bg-primary/5 -skew-y-6 origin-top-left pointer-events-none" />
      
      <div className="w-full max-w-md bg-card rounded-2xl shadow-xl border border-border p-8 relative z-10">
        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
          <Building2 className="w-6 h-6 text-primary" />
        </div>
        
        <h1 className="text-2xl font-serif font-bold text-muted-foreground mb-2">Welcome to Tidyups</h1>
        <p className="text-muted-foreground text-sm mb-8">Let's set up your AI receptionist workspace. What's your cleaning company called?</p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Sparkle Cleaners" className="h-12" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full h-12 text-base gap-2" 
              disabled={createCompany.isPending}
            >
              {createCompany.isPending ? "Creating..." : "Continue to Setup"}
              {!createCompany.isPending && <ArrowRight className="w-4 h-4" />}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
