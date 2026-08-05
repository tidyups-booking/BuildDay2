import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  useGetCompany, useConnectJobber, useDisconnectJobber, getGetCompanyQueryKey, 
  useConnectQuo, useListQuoNumbers, getListQuoNumbersQueryKey, useSelectQuoNumbers, useUpdateCompany,
  useGoLive, useSimulateTestCall, useInviteTeamMember
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Zap, Phone, Settings2, Users, Play, Loader2, PhoneForwarded } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

/**
 * Where we send companies who don't have Quo yet. Set VITE_QUO_AFFILIATE_URL to
 * the PartnerStack referral link to earn commission on these signups.
 */
const QUO_SIGNUP_URL =
  import.meta.env.VITE_QUO_AFFILIATE_URL ?? "https://my.quo.com/signup";

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
      title: "Connect Quo Lines",
      description: "Choose which Quo numbers Sona answers for you.",
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
                      {step.id === "phone" && <PhoneStep company={company} />}
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

function PhoneStep({ company }: { company: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const connectQuo = useConnectQuo();
  const selectNumbers = useSelectQuoNumbers();
  const { data: numbers, isLoading } = useListQuoNumbers({
    query: {
      enabled: !!company.quoConnected,
      queryKey: getListQuoNumbersQueryKey(),
    },
  });

  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const watched =
    selected ?? (numbers ?? []).filter((n) => n.watched).map((n) => n.id);

  const toggle = (id: string) =>
    setSelected(
      watched.includes(id)
        ? watched.filter((x) => x !== id)
        : [...watched, id],
    );

  const refreshCompany = () =>
    queryClient.invalidateQueries({ queryKey: getGetCompanyQueryKey() });

  const handleConnect = () => {
    const key = apiKey.trim();
    if (key.length < 10) {
      toast({
        variant: "destructive",
        title: "That key looks too short",
        description: "Copy the whole key from Quo settings → API.",
      });
      return;
    }
    connectQuo.mutate(
      { data: { apiKey: key } },
      {
        onSuccess: () => {
          setApiKey("");
          refreshCompany();
          queryClient.invalidateQueries({
            queryKey: getListQuoNumbersQueryKey(),
          });
          toast({
            title: "Quo connected",
            description: "We can now see the phone lines in your workspace.",
          });
        },
        onError: (err: any) =>
          toast({
            variant: "destructive",
            title: "Couldn't connect Quo",
            description:
              err?.response?.data?.error ??
              "Check that the API key is valid and still active.",
          }),
      },
    );
  };

  const handleSave = () =>
    selectNumbers.mutate(
      { data: { numberIds: watched } },
      {
        onSuccess: () => {
          setSelected(null);
          refreshCompany();
          queryClient.invalidateQueries({ queryKey: getListQuoNumbersQueryKey() });
          toast({
            title: "Lines connected",
            description:
              "Sona transcripts from these numbers will now flow into your dashboard.",
          });
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: "Couldn't register with Quo",
            description: "Quo rejected the webhook setup for these lines.",
          }),
      },
    );

  if (!company.quoConnected) {
    return (
      <div className="space-y-4">
        <div className="bg-brand-pink/10 border border-brand-pink/20 rounded-xl p-4 flex gap-3 text-sm text-muted-foreground">
          <PhoneForwarded className="w-5 h-5 text-brand-pink shrink-0" />
          <p>
            Your phone lines live in Quo, with Sona answering them. Connect your
            Quo workspace and we'll pull every call's transcript and summary
            into your dashboard — no new number needed.
          </p>
        </div>

        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>
            No Quo account yet?{" "}
            <a
              href={QUO_SIGNUP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-brand-pink underline underline-offset-4"
            >
              Start a free trial
            </a>{" "}
            — you'll need the Business plan for AI call transcripts.
          </li>
          <li>
            In Quo, open <span className="text-foreground">Settings → API</span>{" "}
            and create a key (workspace owners and admins only).
          </li>
          <li>Paste it below. We store it encrypted and never show it again.</li>
        </ol>

        <div className="space-y-2">
          <Label htmlFor="quo-api-key">Quo API key</Label>
          <Input
            id="quo-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Quo API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
          />
        </div>

        <Button onClick={handleConnect} disabled={connectQuo.isPending}>
          {connectQuo.isPending ? "Connecting..." : "Connect Quo Workspace"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose which lines the receptionist watches. We register webhooks with
        Quo so new calls arrive here automatically.
      </p>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(numbers ?? []).map((num) => {
            const on = watched.includes(num.id);
            return (
              <button
                key={num.id}
                type="button"
                onClick={() => toggle(num.id)}
                className={`text-left border rounded-xl p-3 flex items-center justify-between transition-colors bg-card ${
                  on ? "border-primary" : "border-border hover:border-primary/50"
                }`}
              >
                <div>
                  <div className="font-medium text-foreground">{num.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {num.phoneNumber}
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                    on ? "bg-primary border-primary" : "border-border"
                  }`}
                >
                  {on && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Button onClick={handleSave} disabled={selectNumbers.isPending}>
        {selectNumbers.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          `Watch ${watched.length} line${watched.length === 1 ? "" : "s"}`
        )}
      </Button>
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
