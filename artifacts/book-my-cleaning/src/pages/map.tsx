import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import {
  useGetMapConfig,
  useGetMapData,
  useCreateMapPin,
  useDeleteMapPin,
  useGetCompany,
  useGetCurrentUser,
  getGetMapDataQueryKey,
  MapData,
} from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { companyTimeZone, formatZoned, zoneLabel } from "@/lib/time";
import { todayInZone } from "@/lib/schedule";
import {
  loadGoogleMaps,
  DEMO_MAP_ID,
  type GoogleMapsApi,
} from "@/lib/googleMaps";
import {
  colorForTeamMember,
  initials,
  isStale,
  lastSeenLabel,
  hasCoords,
  partitionJobsByCoords,
  assigneeNames,
  accuracyLabel,
} from "@/lib/mapMarkers";
import {
  MapPin,
  RefreshCw,
  AlertTriangle,
  Home,
  Users,
  Briefcase,
  Trash2,
  Plus,
} from "lucide-react";

const REFRESH_MS = 30 * 1000;

export function MapPage() {
  const { data: me } = useGetCurrentUser();
  const role = me?.role ?? "owner";
  // Live positions are dispatch-only; a cleaner has no business tracking peers,
  // and the API blocks them too. Keep the whole page behind the same gate.
  if (role === "cleaner") return <Redirect to="/schedule" />;

  return (
    <AppLayout>
      <PanelErrorBoundary label="live map">
        <MapView />
      </PanelErrorBoundary>
    </AppLayout>
  );
}

function MapView() {
  const { data: company } = useGetCompany();
  const timeZone = companyTimeZone(company);
  const [date, setDate] = useState(() => todayInZone(timeZone));

  const {
    data: config,
    isLoading: configLoading,
    error: configError,
  } = useGetMapConfig();

  const {
    data: mapData,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useGetMapData(
    { date },
    {
      query: {
        queryKey: getGetMapDataQueryKey({ date }),
        // Live view: poll while the tab is open so a dead phone or a new job
        // shows up without a manual refresh.
        refetchInterval: REFRESH_MS,
        refetchOnWindowFocus: true,
      },
    },
  );

  return (
    <>
      <PageHeader
        title="Live Map"
        description="Where your crews are right now, plus today's jobs and saved locations."
      >
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground"
            aria-label="Map date"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh map"
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </PageHeader>

      {configLoading ? (
        <LoadingSpinner className="mt-20" />
      ) : configError || !config ? (
        <UnavailableCard reason="load-config" />
      ) : !config.configured ? (
        <UnavailableCard reason="not-configured" />
      ) : (
        <LiveMap
          apiKey={config.apiKey}
          date={date}
          mapData={mapData}
          timeZone={timeZone}
          lastUpdated={dataUpdatedAt}
          isFetching={isFetching}
        />
      )}
    </>
  );
}

/**
 * Calm explanatory card for the two states where the map genuinely can't run:
 * the key isn't set up, or /map/config itself failed. Never a crash or an
 * endless spinner — the owner needs to know what to fix.
 */
function UnavailableCard({
  reason,
}: {
  reason: "not-configured" | "load-config";
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-12 text-center">
      <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
        <MapPin className="w-6 h-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1">
        The live map isn&apos;t set up yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {reason === "load-config"
          ? "We couldn't reach the map service. Refresh in a moment, or check back shortly."
          : "A Google Maps API key needs to be configured for your workspace. Add a key with the Maps JavaScript API and Geocoding API enabled to see crews and jobs on a map."}
      </p>
    </div>
  );
}

function LiveMap({
  apiKey,
  date,
  mapData,
  timeZone,
  lastUpdated,
  isFetching,
}: {
  apiKey: string;
  date: string;
  mapData: MapData | undefined;
  timeZone: string;
  lastUpdated: number;
  isFetching: boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [maps, setMaps] = useState<GoogleMapsApi | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);

  // Google surfaces "key not authorized for Maps JS" ONLY through this global.
  // Without it the map silently greys out. Register it before the script runs.
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => setAuthFailed(true);
    return () => {
      window.gm_authFailure = prev;
    };
  }, []);

  // Load the script once the runtime key is in hand.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((api) => {
        if (!cancelled) setMaps(api);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // Build the map exactly once the script is ready and the container exists.
  useEffect(() => {
    if (!maps || !mapContainerRef.current || mapRef.current) return;
    mapRef.current = new maps.Map(mapContainerRef.current, {
      center: { lat: 51.0447, lng: -114.0719 },
      zoom: 11,
      mapId: DEMO_MAP_ID,
      disableDefaultUI: false,
      clickableIcons: false,
    });
    infoWindowRef.current = new maps.InfoWindow();
  }, [maps]);

  const { located: locatedJobs, unlocated: unlocatedJobs } = useMemo(
    () => partitionJobsByCoords(mapData?.jobs ?? []),
    [mapData],
  );

  // Redraw markers whenever the data changes. Every marker + listener from the
  // previous render is torn down first, so refreshes never leak markers.
  useEffect(() => {
    if (!maps || !mapRef.current) return;
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;

    // Tear down the previous batch.
    for (const marker of markersRef.current) {
      if (marker.__listener) marker.__listener.remove();
      marker.map = null;
    }
    markersRef.current = [];

    const bounds = new maps.LatLngBounds();
    let any = false;

    const attach = (marker: any, html: string) => {
      marker.__listener = marker.addListener("gmp-click", () => {
        infoWindow.setContent(html);
        infoWindow.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
    };

    // Cleaners — coloured initials, faded when stale.
    for (const c of mapData?.cleaners ?? []) {
      if (!hasCoords(c)) continue;
      const stale = isStale(c.updatedAt);
      const el = document.createElement("div");
      el.style.cssText = `width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 12px/1 "Plus Jakarta Sans",sans-serif;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);background:${colorForTeamMember(
        c.teamMemberId,
      )};opacity:${stale ? "0.45" : "1"};`;
      el.textContent = initials(c.name);
      const marker = new maps.AdvancedMarkerElement({
        map,
        position: { lat: c.lat, lng: c.lng },
        content: el,
        title: c.name,
        zIndex: 3,
      });
      const acc = accuracyLabel(c);
      attach(
        marker,
        `<div style="font-family:sans-serif;color:#111;min-width:150px">
          <div style="font-weight:700">${escapeHtml(c.name)}</div>
          <div style="font-size:12px;color:#555">Cleaner${
            acc ? ` · ${acc}` : ""
          }</div>
          <div style="font-size:12px;color:${
            stale ? "#b45309" : "#16a34a"
          };margin-top:2px">
            ${stale ? `Last seen ${lastSeenLabel(c.updatedAt)}` : "Live now"}
          </div>
        </div>`,
      );
      bounds.extend({ lat: c.lat, lng: c.lng });
      any = true;
    }

    // Job pins — square pink glyph, distinct from round cleaner dots.
    for (const j of locatedJobs) {
      const el = document.createElement("div");
      el.style.cssText = `width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;background:hsl(330,81%,55%);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);`;
      el.innerHTML = briefcaseSvg();
      const marker = new maps.AdvancedMarkerElement({
        map,
        position: { lat: j.lat, lng: j.lng },
        content: el,
        title: j.customerName,
        zIndex: 2,
      });
      attach(
        marker,
        `<div style="font-family:sans-serif;color:#111;min-width:170px">
          <div style="font-weight:700">${escapeHtml(j.customerName)}</div>
          <div style="font-size:12px;color:#555">${escapeHtml(
            j.customerAddress || "Address not provided",
          )}</div>
          <div style="font-size:12px;color:#555;margin-top:2px">${escapeHtml(
            formatZoned(j.scheduledFor, timeZone),
          )} ${escapeHtml(zoneLabel(timeZone, new Date(j.scheduledFor)))}</div>
          <div style="font-size:12px;color:#555">Status: ${escapeHtml(
            j.status,
          )}</div>
          <div style="font-size:12px;color:#555;margin-top:2px">Crew: ${escapeHtml(
            assigneeNames(j),
          )}</div>
        </div>`,
      );
      bounds.extend({ lat: j.lat, lng: j.lng });
      any = true;
    }

    // Homeowner pins — teardrop-style purple house, distinct again.
    for (const p of mapData?.pins ?? []) {
      if (!hasCoords(p)) continue;
      const el = document.createElement("div");
      el.style.cssText = `width:26px;height:26px;border-radius:6px 6px 6px 0;transform:rotate(45deg);display:flex;align-items:center;justify-content:center;background:hsl(276,60%,55%);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);`;
      const inner = document.createElement("div");
      inner.style.cssText = "transform:rotate(-45deg);color:#fff;";
      inner.innerHTML = homeSvg();
      el.appendChild(inner);
      const marker = new maps.AdvancedMarkerElement({
        map,
        position: { lat: p.lat, lng: p.lng },
        content: el,
        title: p.name,
        zIndex: 1,
      });
      attach(
        marker,
        `<div style="font-family:sans-serif;color:#111;min-width:150px">
          <div style="font-weight:700">${escapeHtml(p.name)}</div>
          <div style="font-size:12px;color:#555">${escapeHtml(
            p.address || "Saved location",
          )}</div>
        </div>`,
      );
      bounds.extend({ lat: p.lat, lng: p.lng });
      any = true;
    }

    if (any && !bounds.isEmpty()) {
      map.fitBounds(bounds, 64);
    }
  }, [maps, mapData, locatedJobs, timeZone]);

  // Final cleanup on unmount — no markers, listeners or info window left behind.
  useEffect(() => {
    return () => {
      for (const marker of markersRef.current) {
        if (marker.__listener) marker.__listener.remove();
        marker.map = null;
      }
      markersRef.current = [];
      if (infoWindowRef.current) infoWindowRef.current.close();
    };
  }, []);

  return (
    <div className="space-y-4">
      {authFailed && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-300">
              Google rejected the Maps key
            </p>
            <p className="text-amber-200/80 mt-1">
              The map can&apos;t draw because this key isn&apos;t authorized for
              the <strong>Maps JavaScript API</strong>. Enable Maps JavaScript
              API (and Geocoding API for adding pins by address) in Google Cloud
              for this key, then refresh.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <Legend />
        <span>
          {isFetching
            ? "Refreshing…"
            : lastUpdated
              ? `Last updated ${new Date(lastUpdated).toLocaleTimeString()}`
              : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-sm overflow-hidden relative min-h-[420px]">
          {loadError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">
                We couldn&apos;t load Google Maps. Check your connection and
                refresh.
              </p>
            </div>
          )}
          {!maps && !loadError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
              <LoadingSpinner />
            </div>
          )}
          <div ref={mapContainerRef} className="w-full h-[420px] lg:h-full" />
        </div>

        <div className="space-y-4">
          <PinManager date={date} pins={mapData?.pins ?? []} />
          {unlocatedJobs.length > 0 && (
            <div className="bg-card border border-border rounded-xl shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-muted-foreground" />
                Not yet located ({unlocatedJobs.length})
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                These jobs have no map coordinates yet, so they can&apos;t be
                pinned.
              </p>
              <ul className="space-y-2">
                {unlocatedJobs.map((j) => (
                  <li
                    key={j.bookingId}
                    className="text-sm border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="font-medium text-foreground">
                      {j.customerName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {j.customerAddress || "Address not provided"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatZoned(j.scheduledFor, timeZone)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-brand-blue inline-block" />
        <Users className="w-3 h-3" /> Cleaners
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-brand-pink inline-block" />
        <Briefcase className="w-3 h-3" /> Jobs
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-brand-purple inline-block" />
        <Home className="w-3 h-3" /> Saved pins
      </span>
    </div>
  );
}

/** Add a homeowner pin by address (server geocodes) and delete existing pins. */
function PinManager({ date, pins }: { date: string; pins: MapData["pins"] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createPin = useCreateMapPin();
  const deletePin = useDeleteMapPin();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getGetMapDataQueryKey({ date }),
    });

  const handleAdd = () => {
    if (!name.trim()) return;
    createPin.mutate(
      { data: { name: name.trim(), address: address.trim() || undefined } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Pin added",
            description: `${name.trim()} is now on the map.`,
          });
          setName("");
          setAddress("");
        },
        onError: (error: any) => {
          toast({
            title: "Couldn't add the pin",
            description:
              error?.data?.error ||
              error?.message ||
              "We couldn't geocode that address. Check it and try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleDelete = (id: number, pinName: string) => {
    deletePin.mutate(
      { id },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Pin removed", description: `${pinName} removed.` });
        },
      },
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <Home className="w-4 h-4 text-muted-foreground" />
        Saved locations
      </h3>
      <div className="space-y-2 mb-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Label (e.g. Smith residence)"
        />
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address to geocode"
        />
        <Button
          onClick={handleAdd}
          disabled={createPin.isPending || !name.trim()}
          className="w-full gap-2"
        >
          <Plus className="w-4 h-4" />
          {createPin.isPending ? "Adding…" : "Add pin"}
        </Button>
      </div>

      {pins.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No saved pins yet. Add a homeowner or landmark above.
        </p>
      ) : (
        <ul className="space-y-2">
          {pins.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 text-sm border-b border-border/60 pb-2 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground truncate">
                  {p.name}
                </div>
                {p.address && (
                  <div className="text-xs text-muted-foreground truncate">
                    {p.address}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(p.id, p.name)}
                disabled={deletePin.isPending}
                aria-label={`Delete ${p.name}`}
                className="text-muted-foreground hover:text-red-400 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function briefcaseSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;
}

function homeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
}
