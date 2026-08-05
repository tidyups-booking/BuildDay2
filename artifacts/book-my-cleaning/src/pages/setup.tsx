import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  useGetCompany, useConnectJobber, useDisconnectJobber, getGetCompanyQueryKey, 
  useListAvailableNumbers, getListAvailableNumbersQueryKey, useProvisionNumber, useUpdateCompany,
  useGoLive, useSimulateTestCall, useInviteTeamMember
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Zap, Phone, Settings2, Users, Play, Loader2, PhoneForwarded } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

export function SetupPage() {
  const { data: company, isLoading } = useGetCompany();

  if (isLoading || !company) {
    return (
      <AppLayout>
        <LoadingSpinner className="mt-20" />
      </AppLayout>
    );
  }

  const steps = [
    {
      id: "account",
      title: "Account Created",
      description: "Your workspace is ready.",
      icon: Check,
      isDone: company.setupStatus.accountCreated,
      isActive: false,
    },
    {
      id: "jobber",
      title: "Connect Jobber",
      description: "Link your Jobber account to sync your schedule.",
      icon: Zap,
      isDone: company.setupStatus.jobberConnected,
      isActive: company.setupStatus.accountCreated && !company.setupStatus.jobberConnected,
    },
    {
      id: "phone",
      title: "Provision Number",
      description: "Get a local phone number for your AI receptionist.",
      icon: Phone,
      isDone: company.setupStatus.phoneProvisioned,
      isActive: company.setupStatus.jobberConnected && !company.setupStatus.phoneProvisioned,
    },
    {
      id: "customize",
      title: "Customize AI",
      description: "Set your greeting, pricing, and FAQs.",
      icon: Settings2,
      isDone: company.setupStatus.receptionistConfigured,
      isActive: company.setupStatus.phoneProvisioned && !company.setupStatus.receptionistConfigured,
    },
    {
      id: "team",
      title: "Invite Team",
      description: "Add dispatchers and cleaners to your workspace.",
      icon: Users,
      isDone: company.setupStatus.teamInvited,
      isActive: company.setupStatus.receptionistConfigured && !company.setupStatus.teamInvited,
    },
    {
      id: "live",
      title: "Go Live",
      description: "Run a test call and turn on the system.",
      icon: Play,
      isDone: company.setupStatus.isLive,
      isActive: company.setupStatus.teamInvited && !company.setupStatus.isLive,
    }
  ];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <PageHeader 
          title="Setup your AI Receptionist" 
          description="Complete these steps to get your automated booking system up and running." 
        />

        <div className="space-y-4">
          {steps.map((step, index) => {
            const isLocked = !step.isDone && !step.isActive;
            const Icon = step.icon;

            return (
              <div 
                key={step.id} 
                className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
                  step.isActive ? "border-primary shadow-md bg-card ring-1 ring-primary/20" : 
                  step.isDone ? "border-border bg-card" : "border-border bg-secondary/50 opacity-60"
                }`}
              >
                <div className="p-5 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    step.isDone ? "bg-green-500/100/10 text-green-400" : 
                    step.isActive ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"
                  }`}>
                    {step.isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold text-lg ${isLocked ? "text-muted-foreground" : "text-muted-foreground"}`}>
                      {index + 1}. {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                  {step.isDone && !step.isActive && (
                    <div className="text-sm font-medium text-green-400 px-3 py-1 bg-green-500/10 rounded-full">
                      Done
                    </div>
                  )}
                </div>

                {step.isActive && (
                  <div className="p-5 pt-0 border-t border-border mt-2 bg-secondary/30">
                    <div className="pt-4">
                      {step.id === "jobber" && <JobberStep company={company} />}
                      {step.id === "phone" && <PhoneStep />}
                      {step.id === "customize" && <CustomizeStep company={company} />}
                      {step.id === "team" && <TeamStep />}
                      {step.id === "live" && <GoLiveStep company={company} />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}

function JobberStep({ company }: { company: any }) {
  const queryClient = useQueryClient();
  const connect = useConnectJobber();

  const handleConnect = () => {
    connect.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-brand-purple/10 border border-brand-purple/20 rounded-xl p-4 flex gap-3 text-sm text-blue-800">
        <Zap className="w-5 h-5 text-blue-600 shrink-0" />
        <p>Connecting Jobber allows your AI receptionist to read your schedule, quote accurate wait times, and create pending jobs directly.</p>
      </div>
      <Button onClick={handleConnect} disabled={connect.isPending} className="w-full sm:w-auto">
        {connect.isPending ? "Connecting..." : "Connect Jobber Account"}
      </Button>
    </div>
  );
}

function PhoneStep() {
  const [areaCode, setAreaCode] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const { data: numbers, isLoading, refetch } = useListAvailableNumbers(
    { areaCode: areaCode || undefined }, 
    { query: { enabled: false, queryKey: getListAvailableNumbersQueryKey({ areaCode: areaCode || undefined }) } }
  );
  const provision = useProvisionNumber();
  const queryClient = useQueryClient();

  const handleSearch = () => {
    setHasSearched(true);
    refetch();
  };

  const handleProvision = (phoneNumber: string) => {
    provision.mutate({ data: { phoneNumber } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 max-w-sm">
        <Input 
          placeholder="Area Code (e.g. 415)" 
          value={areaCode} 
          onChange={(e) => setAreaCode(e.target.value)} 
          maxLength={3}
        />
        <Button variant="secondary" onClick={handleSearch} disabled={isLoading || areaCode.length < 3}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
        </Button>
      </div>

      {hasSearched && !isLoading && numbers && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {numbers.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-2">No numbers found for this area code.</p>
          ) : (
            numbers.map((num) => (
              <div key={num.phoneNumber} className="border border-border rounded-xl p-3 flex items-center justify-between hover:border-primary transition-colors bg-card">
                <div>
                  <div className="font-mono font-medium text-muted-foreground">{num.phoneNumber}</div>
                  <div className="text-xs text-muted-foreground">{num.locality}, {num.region}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleProvision(num.phoneNumber)} disabled={provision.isPending}>
                  Select
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CustomizeStep({ company }: { company: any }) {
  const update = useUpdateCompany();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [greeting, setGreeting] = useState(company.greeting || "Hi, thanks for calling Tidyups. How can I help you today?");
  const [ringThrough, setRingThrough] = useState(company.ringThroughNumber || "");

  const handleSave = () => {
    update.mutate({ data: { greeting, ringThroughNumber: ringThrough } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
        toast({ title: "Configuration saved", description: "AI settings updated. We'll mark this step complete." });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>AI Greeting Message</Label>
        <Textarea 
          value={greeting} 
          onChange={(e) => setGreeting(e.target.value)} 
          placeholder="Hi, thanks for calling..."
          className="resize-none h-24"
        />
        <p className="text-xs text-muted-foreground">This is the first thing callers will hear.</p>
      </div>

      <div className="space-y-2">
        <Label>Ring-through Number (Optional)</Label>
        <Input 
          value={ringThrough} 
          onChange={(e) => setRingThrough(e.target.value)} 
          placeholder="+1 (555) 000-0000"
        />
        <p className="text-xs text-muted-foreground">If the AI gets stuck or the user demands a human, it will transfer the call here.</p>
      </div>

      <div className="bg-secondary p-4 rounded-xl text-sm text-muted-foreground mb-4">
        <strong>Tip:</strong> You can configure detailed services and custom Q&A later in Settings. Let's get the basics down first.
      </div>

      <Button onClick={handleSave} disabled={update.isPending} className="w-full sm:w-auto">
        {update.isPending ? "Saving..." : "Save & Continue"}
      </Button>
    </div>
  );
}

function TeamStep() {
  const invite = useInviteTeamMember();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  
  const handleInvite = () => {
    invite.mutate({ data: { email, name, role: "dispatcher" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <Button onClick={handleInvite} disabled={invite.isPending || !email || !name}>
        {invite.isPending ? "Inviting..." : "Invite Member"}
      </Button>
      <p className="text-xs text-muted-foreground">You must invite at least one team member to proceed.</p>
    </div>
  );
}

function GoLiveStep({ company }: { company: any }) {
  const goLive = useGoLive();
  const testCall = useSimulateTestCall();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGoLive = () => {
    goLive.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });
        toast({ title: "You're Live!", description: "Your AI receptionist is now taking calls." });
        setLocation("/dashboard");
      }
    });
  };

  return (
    <div className="space-y-4 text-center py-4">
      <div className="w-16 h-16 bg-green-500/100/10 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
        <PhoneForwarded className="w-8 h-8" />
      </div>
      <h4 className="text-xl font-bold text-muted-foreground">Ready to Answer Calls</h4>
      <p className="text-muted-foreground max-w-sm mx-auto">Your AI is configured, Jobber is connected, and your new phone number ({company.phoneNumber}) is ready.</p>
      
      <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
        <Button variant="outline" onClick={() => testCall.mutate(undefined)} disabled={testCall.isPending}>
          {testCall.isPending ? "Simulating..." : "Simulate Test Call"}
        </Button>
        <Button onClick={handleGoLive} disabled={goLive.isPending} className="bg-green-600 hover:bg-green-700 text-white">
          Go Live Now
        </Button>
      </div>
    </div>
  );
}
