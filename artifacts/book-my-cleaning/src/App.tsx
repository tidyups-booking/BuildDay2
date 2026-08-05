import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import { MarketingPage } from "@/pages/marketing";
import { DashboardPage } from "@/pages/dashboard";
import { SetupPage } from "@/pages/setup";
import { OnboardingPage } from "@/pages/onboarding";
import { CallsPage } from "@/pages/calls";
import { BookingsPage } from "@/pages/bookings";
import { TeamPage } from "@/pages/team";
import { SettingsPage } from "@/pages/settings";
import QuotePage from "@/pages/quote";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(330, 81%, 60%)", // Pink
    colorForeground: "hsl(0, 0%, 100%)",
    colorMutedForeground: "hsl(276, 15%, 65%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(276, 20%, 5%)",
    colorInput: "hsl(276, 20%, 16%)",
    colorInputForeground: "hsl(0, 0%, 100%)",
    colorNeutral: "hsl(276, 20%, 15%)",
    fontFamily: '"Plus Jakarta Sans", sans-serif',
    borderRadius: "0.8rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl border border-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none pb-6",
    headerTitle: "font-serif text-2xl font-extrabold tracking-tight text-foreground",
    headerSubtitle: "text-sm text-muted-foreground",
    socialButtonsBlockButtonText: "font-medium text-foreground",
    formFieldLabel: "text-sm font-medium text-foreground",
    footerActionLink: "font-semibold text-primary hover:text-primary/90",
    footerActionText: "text-muted-foreground",
    dividerText: "text-xs text-muted-foreground font-medium",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-500",
    alertText: "text-sm font-medium",
    logoBox: "h-12 w-12 mx-auto mb-4",
    logoImage: "w-full h-full object-contain",
    socialButtonsBlockButton: "border-border hover:bg-secondary/50 transition-colors",
    formButtonPrimary: "bg-primary hover:opacity-90 text-primary-foreground font-bold shadow-sm transition-all rounded-full",
    formFieldInput: "border-border focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all rounded-lg bg-input",
    footerAction: "mt-4",
    dividerLine: "bg-border",
    alert: "border border-red-500/20 bg-red-500/10 text-red-500",
    otpCodeFieldInput: "border-border focus:border-primary",
    formFieldRow: "gap-2",
    main: "gap-6",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-brand-purple/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-brand-pink/20 rounded-full blur-[100px] pointer-events-none" />
      
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-brand-purple/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-brand-pink/20 rounded-full blur-[100px] pointer-events-none" />

      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <MarketingPage />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to manage your AI receptionist",
          },
        },
        signUp: {
          start: {
            title: "Start answering calls",
            subtitle: "Create your Book My Cleaning account",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            {/* Public: the customer following the link in their quote text has
                no account and must never be bounced to a sign-in page. */}
            <Route path="/quote/:token" component={QuotePage} />
            
            <Route path="/onboarding" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <OnboardingPage />
              </Show>
            )} />
            <Route path="/setup" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <SetupPage />
              </Show>
            )} />
            <Route path="/dashboard" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <DashboardPage />
              </Show>
            )} />
            <Route path="/calls" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <CallsPage />
              </Show>
            )} />
            <Route path="/bookings" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <BookingsPage />
              </Show>
            )} />
            <Route path="/team" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <TeamPage />
              </Show>
            )} />
            <Route path="/settings" component={() => (
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <SettingsPage />
              </Show>
            )} />
            
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
