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
            "flex size-9 items-center justify-center rounded-md outline-none transition-[background-color]",
            // The rail scopes `dark` + remaps --sidebar to --rail, so the
            // sidebar tokens resolve to the rail's own warm dark plane —
            // no hardcoded white alphas needed.
            "text-sidebar-foreground hover:bg-sidebar-accent",
            "focus-visible:shadow-focus",
          )}
          title={displayName}
          aria-label={`Account menu for ${displayName}`}
        >
          <Avatar className="size-6">
            <AvatarImage src={user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-xs">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="min-w-56">
          <DropdownMenuGroup>
            {/* The account name is a heading, not a section label — 14px
                primary ink, not the 12px faint rung menus use for groups. */}
            <DropdownMenuLabel className="truncate text-sm font-medium text-foreground">
              {displayName}
            </DropdownMenuLabel>
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
