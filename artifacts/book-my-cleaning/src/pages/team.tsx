import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, LoadingSpinner } from "@/components/ui/shared";
import {
  useListTeamMembers,
  useInviteTeamMember,
  useRemoveTeamMember,
  getListTeamMembersQueryKey,
  TeamMember,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Mail, UserX, UserPlus, Shield, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export function TeamPage() {
  const { data: team, isLoading } = useListTeamMembers();
  const removeMember = useRemoveTeamMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRemove = (id: number) => {
    if (!confirm("Remove this team member?")) return;
    removeMember.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListTeamMembersQueryKey(),
          });
          toast({
            title: "Member removed",
            description: "Team member access revoked.",
          });
        },
      },
    );
  };

  return (
    <AppLayout>
      <PageHeader
        title="Team Members"
        description="Manage who has access to your workspace."
      >
        <InviteModal />
      </PageHeader>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {team?.map((member: TeamMember) => (
              <div
                key={member.id}
                className="p-4 px-6 flex items-center justify-between hover:bg-secondary transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-medium text-muted-foreground flex items-center gap-2">
                      {member.name}
                      {member.status === "invited" && (
                        <Badge variant="secondary" className="text-xs py-0 h-5">
                          Invited
                        </Badge>
                      )}
                    </h4>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {member.email}
                      </span>
                      <span className="flex items-center gap-1">
                        {member.role === "owner" ? (
                          <Shield className="w-3 h-3 text-amber-500" />
                        ) : (
                          <User className="w-3 h-3" />
                        )}
                        <span className="capitalize">{member.role}</span>
                      </span>
                    </div>
                  </div>
                </div>
                {member.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-700 hover:bg-red-500/10"
                    onClick={() => handleRemove(member.id)}
                    disabled={removeMember.isPending}
                  >
                    <UserX className="w-4 h-4 mr-2" />
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function InviteModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"dispatcher" | "cleaner">("dispatcher");

  const invite = useInviteTeamMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleInvite = () => {
    invite.mutate(
      { data: { name, email, role } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListTeamMembersQueryKey(),
          });
          toast({
            title: "Invite sent",
            description: `An invitation was sent to ${email}.`,
          });
          setOpen(false);
          setName("");
          setEmail("");
          setRole("dispatcher");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="w-4 h-4" /> Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              value={email}
              type="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(val: any) => setRole(val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dispatcher">
                  Dispatcher (Can view & edit bookings)
                </SelectItem>
                <SelectItem value="cleaner">
                  Cleaner (Can view assigned jobs only)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleInvite}
            className="w-full mt-4"
            disabled={invite.isPending || !name || !email}
          >
            {invite.isPending ? "Sending Invite..." : "Send Invitation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
