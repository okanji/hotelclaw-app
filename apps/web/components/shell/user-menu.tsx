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
import { LogOut, UserCog } from "lucide-react";
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
 * Account menu pinned to the sidebar footer — a nav row (avatar + name) that
 * opens the account menu above it.
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
            // The sidebar row contract: 30px, 7px radius, 8px inset, 14px
            // label in secondary ink, warm hover fill only.
            "flex h-[30px] w-full min-w-0 items-center gap-2.5 rounded-[7px] px-2 text-left text-sm text-sidebar-foreground outline-hidden transition-colors",
            "hover:bg-sidebar-accent data-[popup-open]:bg-sidebar-accent",
            "focus-visible:shadow-focus",
          )}
          title={displayName}
          aria-label={`Account menu for ${displayName}`}
        >
          <Avatar className="size-5">
            <AvatarImage src={user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-[10px]">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate">{displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
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
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialName={user.name}
        initialAvatarUrl={user.avatarUrl}
        email={user.email}
        userId={user.id}
        onDeleteAccount={() => {
          setProfileOpen(false);
          setDeleteOpen(true);
        }}
      />

      <DeleteAccountDialog
        email={user.email}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}
