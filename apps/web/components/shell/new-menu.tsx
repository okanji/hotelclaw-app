"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  FolderKanban,
  ListTodo,
  Plus,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateDocumentDialog } from "@/components/documents/create-document-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { Gi } from "@/components/gr8r/icon";

/**
 * The one "create anything" entry, beside Search at the top of the sidebar
 * (gr8r's top-bar "New ▾"). Each item reuses the create flow its own section
 * already owns — no second implementation of any of them.
 */
export function NewMenu({
  propertyId,
  variant = "icon",
}: {
  propertyId: string;
  /** "button" = gr8r's topbar `New ▾` secondary button (2026-10-29). */
  variant?: "icon" | "button";
}) {
  const router = useRouter();
  const base = `/p/${propertyId}`;
  const [docOpen, setDocOpen] = useState(false);
  const [entity, setEntity] = useState<{
    open: boolean;
    kind: "space" | "project";
  }>({ open: false, kind: "project" });

  return (
    <>
      <DropdownMenu>
        {variant === "button" ? (
          // gr8r topbar `btn btn-secondary btn-sm`: plus, "New", chevron-down.
          <DropdownMenuTrigger aria-label="Create new" className="btn btn-secondary btn-sm">
            <Gi icon={Plus} size={14} />
            <span className="hide-m">New</span>
            <Gi icon={ChevronDown} size={12} className="hide-m" />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            aria-label="Create new"
            title="Create new"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-secondary-ink outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:shadow-focus data-[popup-open]:bg-sidebar-accent"
          >
            <Plus className="size-4" />
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent align="end" sideOffset={4} className="w-52">
          <DropdownMenuItem onClick={() => router.push(`${base}/tasks/new`)}>
            <ListTodo />
            <span className="flex-1">Task</span>
            <span className="text-xs text-faint-foreground">N</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDocOpen(true)}>
            <FileText />
            <span>Document</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/forms?new=1`)}>
            <ClipboardList />
            <span>Form</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setEntity({ open: true, kind: "project" })}
          >
            <FolderKanban />
            <span>Project</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEntity({ open: true, kind: "space" })}
          >
            <Users />
            <span>Team</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateDocumentDialog
        open={docOpen}
        onOpenChange={setDocOpen}
        propertyId={propertyId}
      />
      <CreateEntityDialog
        open={entity.open}
        onOpenChange={(open) => setEntity((e) => ({ ...e, open }))}
        propertyId={propertyId}
        kind={entity.kind}
      />
    </>
  );
}
