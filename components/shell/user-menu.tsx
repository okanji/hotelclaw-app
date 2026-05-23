"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Trash2, UserCog } from "lucide-react";
import { EditProfileDialog } from "./edit-profile-dialog";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ThemeToggle } from "./theme-toggle";
import { TimeFormatToggle } from "./time-format-toggle";
import { NotificationsToggle } from "./notifications-toggle";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

type User = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Account menu pinned to the bottom of the icon rail — avatar-only trigger.
 */
export function UserMenu({ user }: { user: User }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const initials = (user.name ?? user.email ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const displayName = user.name ?? user.email;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex size-9 items-center justify-center rounded-lg outline-hidden transition-colors",
            "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
          title={displayName}
          aria-label={`Account menu for ${displayName}`}
        >
          <Avatar className="size-7">
            <AvatarImage src={user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-[11px]">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setProfileOpen(true)}>
              <UserCog className="size-4" />
              Edit profile
            </DropdownMenuItem>
            <ThemeToggle />
            <TimeFormatToggle />
            <NotificationsToggle />
            <DropdownMenuItem
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <Trash2 className="size-4" />
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialName={user.name}
        initialAvatarUrl={user.avatarUrl}
        email={user.email}
        userId={user.id}
      />

      <DeleteAccountDialog
        email={user.email}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}
