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
import { ChevronsUpDown, LogOut, UserCog } from "lucide-react";
import { EditProfileDialog } from "./edit-profile-dialog";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ThemeToggle } from "./theme-toggle";
import { TimeFormatToggle } from "./time-format-toggle";
import { NotificationsToggle } from "./notifications-toggle";
import { signOut } from "@/lib/auth/actions";

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
        {/* gr8r `.side-bot` user row: 36px sitem, avatar, name in text
            colour 500, chevrons-up-down in the count slot. */}
        <DropdownMenuTrigger
          className="sitem"
          style={{ height: 36 }}
          title={displayName}
          aria-label={`Account menu for ${displayName}`}
        >
          <Avatar className="size-[22px]">
            <AvatarImage src={user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-[10px]">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          <span className="trunc" style={{ color: "var(--g8-text)", fontWeight: 500 }}>
            {displayName}
          </span>
          <span className="ct">
            <ChevronsUpDown className="i" size={13} strokeWidth={1.8} />
          </span>
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
