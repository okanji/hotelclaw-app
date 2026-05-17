"use client";

import { useState } from "react";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
import { ChevronsUpDown, LogOut, Trash2, UserCog } from "lucide-react";
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
 * Account widget at the bottom of the left shell. Rendered by `LeftShell` so
 * the bar spans the rail + secondary sidebar — flush with the app's left edge.
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

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
              <Avatar className="size-7">
                <AvatarImage src={user.avatarUrl ?? undefined} />
                <AvatarFallback>{initials || "?"}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {user.name ?? user.email}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{user.name ?? user.email}</DropdownMenuLabel>
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
        </SidebarMenuItem>
      </SidebarMenu>

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
    </SidebarFooter>
  );
}
