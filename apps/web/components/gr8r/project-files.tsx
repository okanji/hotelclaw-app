"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  List,
  NotebookText,
  Plus,
  Search,
  SearchX,
  Upload,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { createDocument } from "@/components/documents/actions";
import { setDocumentProject } from "@/components/projects/actions";
import { AddPicker } from "@/components/projects/workspace-panels";
import { activityTimeAgo } from "@/components/activity/activity-log";
import { Gi } from "./icon";
import { Av } from "./home-glyphs";
import { G8Empty } from "./members-shared";
import type { CSSVars } from "./project-page";

/**
 * The project's Docs tab — docs AND files in one place (user decision
 * 2026-10-29), on gr8r's `filesHtml` (src/views/files.js): a `.toolbar`
 * (search, type, sort, grid / list `.seg`, Add docs, New doc, Upload) over
 * gr8r's `.dropzone`, live `.upl` progress rows, and an `.fgrid` of
 * `.fcard`s or a `perm-t` table. Three kinds of item:
 *  - the project's **docs** (`documents.project_id`) — open in the editor;
 *    "New doc" creates one already linked, "Add docs" links existing ones,
 *    × unlinks (the doc stays in Docs);
 *  - files uploaded onto the **project** (`project_files` + the private
 *    `project-files` bucket, migration 0121 — removable by the uploader or
 *    an owner / manager);
 *  - the attachments on its **tasks** (badge links back to the task).
 * `?tab=files` is an alias of this tab.
 */

/** Matches the bucket's `file_size_limit` (0121). */
const MAX_BYTES = 50 * 1024 * 1024;

type FKind = "page" | "pdf" | "img" | "sheet" | "doc" | "code" | "zip" | "other";
const FT: Record<FKind, { c: string; icon: LucideIcon; n: string }> = {
  page: { c: "var(--g8-accent)", icon: NotebookText, n: "Doc" },
  pdf: { c: "var(--g8-red)", icon: FileText, n: "PDF" },
  img: { c: "var(--g8-teal)", icon: ImageIcon, n: "Image" },
  sheet: { c: "var(--g8-green)", icon: FileSpreadsheet, n: "Spreadsheet" },
  doc: { c: "var(--g8-blue)", icon: FileText, n: "Text" },
  code: { c: "var(--g8-amber)", icon: FileCode, n: "Code" },
  zip: { c: "var(--g8-gray)", icon: FileArchive, n: "Archive" },
  other: { c: "var(--g8-gray)", icon: FileIcon, n: "File" },
};

function kindOf(name: string): FKind {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e === "pdf") return "pdf";
  if (["zip", "rar", "7z"].includes(e)) return "zip";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(e)) return "img";
  if (["xlsx", "xls", "csv", "numbers"].includes(e)) return "sheet";
  if (["doc", "docx", "txt", "md", "pages", "rtf"].includes(e)) return "doc";
  if (["js", "ts", "json", "html", "css", "py"].includes(e)) return "code";
  return "other";
}
function fsize(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

type Attachment = {
  id: string;
  task_id: string;
  file_name: string;
  storage_path: string;
  byte_size: number | null;
  created_by: string | null;
  created_at: string;
};

type ProjectFileRow = {
  id: string;
  file_name: string;
  storage_path: string;
  byte_size: number | null;
  created_by: string | null;
  created_at: string;
};

type Item = {
  id: string;
  kind: FKind;
  name: string;
  at: string | null;
  size: string;
  by: string | null;
  doc?: boolean;
  att?: Attachment;
  pf?: ProjectFileRow;
};

type Uploading = { id: string; name: string; pct: number };

type Person = { id: string; name: string | null; avatarUrl: string | null };

export function ProjectFiles({
  propertyId,
  projectId,
  viewerId,
  canManage,
  docs,
  docCandidates,
  onDocsChanged,
  taskIds,
  taskTitle,
  people,
}: {
  propertyId: string;
  projectId: string;
  viewerId: string | null;
  /** Owner / manager: may remove anyone's upload (RLS enforces it too). */
  canManage: boolean;
  docs: { id: string; title: string; updated_at?: string | null }[];
  docCandidates: { id: string; title: string }[];
  /** Refresh the project's detail after a doc link change. */
  onDocsChanged: () => void;
  taskIds: string[];
  taskTitle: (id: string) => string | null;
  people: Map<string, Person>;
}) {
  const qc = useQueryClient();
  const openDocument = useOpenDocument(propertyId);
  const [creating, setCreating] = useState(false);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [over, setOver] = useState(false);
  const dragDepth = useRef(0);
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | FKind>("all");
  const [sort, setSort] = useState<"date" | "name" | "type">("date");
  const [view, setView] = useState<"grid" | "list">("grid");

  const sortedIds = useMemo(() => [...taskIds].sort(), [taskIds]);
  const { data: attachments = [] } = useQuery({
    queryKey: ["project-attachments", propertyId, sortedIds],
    queryFn: async (): Promise<Attachment[]> => {
      if (sortedIds.length === 0) return [];
      const supabase = createClient();
      const { data } = await supabase
        .from("task_attachments")
        .select("id, task_id, file_name, storage_path, byte_size, created_by, created_at")
        .in("task_id", sortedIds)
        .order("created_at", { ascending: false });
      return (data ?? []) as Attachment[];
    },
    staleTime: 30_000,
  });

  const filesKey = ["project-files", projectId] as const;
  const { data: projectFiles = [] } = useQuery({
    queryKey: filesKey,
    queryFn: async (): Promise<ProjectFileRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("project_files")
        .select("id, file_name, storage_path, byte_size, created_by, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  /**
   * gr8r's `uploadFiles`: one `.upl` row per file with a real percentage —
   * an XHR to Storage's REST endpoint (supabase-js's upload reports no
   * progress), then the `project_files` row. Files over the bucket limit are
   * refused up front with a toast instead of failing after the transfer.
   */
  async function uploadFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const supabase = createClient();
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      toast.error("Sign in again to upload");
      return;
    }
    await Promise.all(
      files.map(async (file) => {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is over 50 MB`);
          return;
        }
        const id = crypto.randomUUID();
        const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
        const path = `${propertyId}/${projectId}/${id}-${safe}`;
        setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
        try {
          await putWithProgress(path, file, token, (pct) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))),
          );
          const { error } = await supabase.from("project_files").insert({
            property_id: propertyId,
            project_id: projectId,
            file_name: file.name,
            storage_path: path,
            byte_size: file.size,
            mime_type: file.type || null,
          });
          if (error) {
            await supabase.storage.from("project-files").remove([path]);
            throw new Error(error.message);
          }
        } catch (err) {
          toast.error(`Couldn't upload ${file.name}`, {
            description: err instanceof Error ? err.message : undefined,
          });
        } finally {
          setUploads((u) => u.filter((x) => x.id !== id));
          void qc.invalidateQueries({ queryKey: filesKey });
        }
      }),
    );
  }

  async function removeFile(f: ProjectFileRow) {
    const prev = qc.getQueryData<ProjectFileRow[]>(filesKey);
    qc.setQueryData<ProjectFileRow[]>(filesKey, (rows) => rows?.filter((r) => r.id !== f.id));
    const supabase = createClient();
    const { error } = await supabase.from("project_files").delete().eq("id", f.id);
    if (error) {
      if (prev) qc.setQueryData(filesKey, prev);
      toast.error("Couldn't remove that file");
      return;
    }
    await supabase.storage.from("project-files").remove([f.storage_path]);
    toast(`Removed ${f.file_name}`, { duration: 1800 });
  }

  async function linkDoc(id: string, to: string | null) {
    const res = await setDocumentProject(id, to);
    if ("error" in res) toast.error(res.error);
    else onDocsChanged();
  }

  async function newDoc() {
    setCreating(true);
    const res = await createDocument(propertyId);
    if ("error" in res) {
      setCreating(false);
      toast.error(res.error);
      return;
    }
    const linked = await setDocumentProject(res.id, projectId);
    setCreating(false);
    if ("error" in linked) toast.error(linked.error);
    onDocsChanged();
    openDocument(res.id);
  }

  const items = useMemo(() => {
    const all: Item[] = [
      ...docs.map((d) => ({
        id: d.id,
        kind: "page" as const,
        name: d.title || "Untitled",
        at: d.updated_at ?? null,
        size: "Doc",
        by: null,
        doc: true,
      })),
      ...projectFiles.map((f) => ({
        id: f.id,
        kind: kindOf(f.file_name),
        name: f.file_name,
        at: f.created_at,
        size: fsize(f.byte_size),
        by: f.created_by,
        pf: f,
      })),
      ...attachments.map((a) => ({
        id: a.id,
        kind: kindOf(a.file_name),
        name: a.file_name,
        at: a.created_at,
        size: fsize(a.byte_size),
        by: a.created_by,
        att: a,
      })),
    ];
    const needle = q.trim().toLowerCase();
    const out = all.filter(
      (f) => (!needle || f.name.toLowerCase().includes(needle)) && (type === "all" || f.kind === type),
    );
    out.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "type"
          ? a.kind.localeCompare(b.kind)
          : (b.at ?? "").localeCompare(a.at ?? ""),
    );
    return out;
  }, [docs, projectFiles, attachments, q, type, sort]);

  async function open(f: Item) {
    if (f.doc) {
      openDocument(f.id);
      return;
    }
    const src = f.pf
      ? { bucket: "project-files", path: f.pf.storage_path }
      : f.att
        ? { bucket: "task-attachments", path: f.att.storage_path }
        : null;
    if (!src) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(src.bucket)
      .createSignedUrl(src.path, 60 * 10);
    if (error || !data?.signedUrl) {
      toast.error("Couldn't open that file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const filtered = q.trim() !== "" || type !== "all";
  const total = docs.length + projectFiles.length + attachments.length;

  const meta = (f: Item) => {
    const who = f.by ? people.get(f.by) : undefined;
    return [f.size, who?.name?.split(" ")[0], f.at ? activityTimeAgo(f.at) : null]
      .filter(Boolean)
      .join(" · ");
  };
  const taskBadge = (f: Item) =>
    f.att ? (
      <Link
        href={`/p/${propertyId}/tasks/${f.att.task_id}`}
        className="badge"
        onClick={(e) => e.stopPropagation()}
        title="Open the task this file is on"
      >
        <Gi icon={Link2} size={10} />
        <span className="trunc" style={{ maxWidth: 140 }}>
          {taskTitle(f.att.task_id) ?? "Task"}
        </span>
      </Link>
    ) : null;
  const canRemove = (f: Item) =>
    f.doc || (!!f.pf && (canManage || (!!viewerId && f.pf.created_by === viewerId)));
  const removeBtn = (f: Item, cls: string, size: number) =>
    canRemove(f) ? (
      <button
        type="button"
        className={cls}
        aria-label={f.doc ? `Remove ${f.name} from this project` : `Remove ${f.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (f.doc) void linkDoc(f.id, null);
          else if (f.pf) void removeFile(f.pf);
        }}
      >
        <Gi icon={X} size={size} />
      </button>
    ) : null;

  const picker = (
    <input
      type="file"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files?.length) void uploadFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <>
      <div className="toolbar">
        <div className="inwrap">
          <Gi icon={Search} size={13} />
          <input
            className="input search-sm"
            placeholder="Search docs and files"
            aria-label="Search docs and files"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ height: 26, width: "auto", fontSize: 12 }}
          aria-label="Filter by type"
          value={type}
          onChange={(e) => setType(e.target.value as "all" | FKind)}
        >
          <option value="all">All types</option>
          {(Object.keys(FT) as FKind[])
            .filter((k) => k !== "other")
            .map((k) => (
              <option key={k} value={k}>
                {FT[k].n}
              </option>
            ))}
        </select>
        <select
          className="select"
          style={{ height: 26, width: "auto", fontSize: 12 }}
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as "date" | "name" | "type")}
        >
          <option value="date">Sort: Newest</option>
          <option value="name">Sort: Name</option>
          <option value="type">Sort: Type</option>
        </select>
        <span className="sp" />
        <div className="seg">
          <button
            type="button"
            className={view === "grid" ? "on" : ""}
            aria-label="Grid view"
            onClick={() => setView("grid")}
          >
            <Gi icon={LayoutGrid} size={13} />
          </button>
          <button
            type="button"
            className={view === "list" ? "on" : ""}
            aria-label="List view"
            onClick={() => setView("list")}
          >
            <Gi icon={List} size={13} />
          </button>
        </div>
        <AddPicker label="Add docs" candidates={docCandidates} onAdd={(id) => void linkDoc(id, projectId)} />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={creating}
          onClick={() => void newDoc()}
        >
          <Gi icon={Plus} size={13} />
          New doc
        </button>
        <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
          <Gi icon={Upload} size={13} />
          Upload
          {picker}
        </label>
      </div>
      <div
        className="page wide"
        style={{ paddingTop: 16, width: "100%" }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setOver(false);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setOver(false);
          void uploadFiles(e.dataTransfer.files);
        }}
      >
        <label className={over ? "dropzone over" : "dropzone"} style={{ marginBottom: 16 }}>
          <Gi icon={UploadCloud} size={18} />
          <span>
            Drop files here or <span className="link">browse</span> — up to 50 MB each
          </span>
          {picker}
        </label>
        {uploads.length ? (
          <div className="col" style={{ gap: 6, marginBottom: 16 }}>
            {uploads.map((x) => {
              const t = FT[kindOf(x.name)];
              return (
                <div key={x.id} className="upl">
                  <span className="ftype" style={{ "--g8-c": t.c } as CSSVars}>
                    <Gi icon={t.icon} size={14} />
                  </span>
                  <div className="grow">
                    <div className="row">
                      <span className="trunc" style={{ fontWeight: 500 }}>
                        {x.name}
                      </span>
                      <span className="sp" />
                      <span className="faint num" style={{ fontSize: 11.5 }}>
                        {x.pct}%
                      </span>
                    </div>
                    <div className="prog" style={{ marginTop: 6 }}>
                      <i style={{ "--g8-p": x.pct / 100 } as CSSVars} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {items.length === 0 ? (
          <G8Empty
            icon={filtered ? SearchX : FolderOpen}
            title={filtered ? "No results found" : "No docs or files yet"}
            text={
              filtered
                ? "Nothing matches your search."
                : total === 0
                  ? "Write the brief and SOPs with New doc, or upload designs and assets. Files on this project's tasks gather here too."
                  : "Nothing here."
            }
          />
        ) : view === "grid" ? (
          <div className="fgrid">
            {items.map((f) => {
              const t = FT[f.kind];
              return (
                <div
                  key={`${f.doc ? "d" : f.pf ? "p" : "a"}:${f.id}`}
                  className="fcard"
                  role="button"
                  tabIndex={0}
                  onClick={() => void open(f)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void open(f);
                  }}
                  title={f.name}
                >
                  <FilePreview kind={f.kind} name={f.name} />
                  <div className="fi">
                    <span className="fn trunc">{f.name}</span>
                    <span className="fm">{meta(f) || t.n}</span>
                    {f.att ? <span style={{ marginTop: 4 }}>{taskBadge(f)}</span> : null}
                  </div>
                  {removeBtn(f, "ibtn ibtn-xs more", 13)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel" style={{ overflowX: "auto" }}>
            <table className="perm-t" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Name</th>
                  <th style={{ textAlign: "left" }}>Type</th>
                  <th style={{ textAlign: "left" }}>Size</th>
                  <th style={{ textAlign: "left" }}>Uploaded by</th>
                  <th style={{ textAlign: "left" }}>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((f) => {
                  const t = FT[f.kind];
                  const who = f.by ? people.get(f.by) : undefined;
                  return (
                    <tr key={`${f.doc ? "d" : f.pf ? "p" : "a"}:${f.id}`}>
                      <td style={{ paddingLeft: 14 }}>
                        <span className="row">
                          <span className="ftype" style={{ "--g8-c": t.c } as CSSVars}>
                            <Gi icon={t.icon} size={14} />
                          </span>
                          {f.doc ? (
                            <a
                              href={documentHref(propertyId, f.id)}
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                                e.preventDefault();
                                void open(f);
                              }}
                              style={{ fontWeight: 500 }}
                            >
                              {f.name}
                            </a>
                          ) : (
                            <button type="button" onClick={() => void open(f)} style={{ fontWeight: 500 }}>
                              {f.name}
                            </button>
                          )}
                          {taskBadge(f)}
                        </span>
                      </td>
                      <td style={{ textAlign: "left" }} className="muted">
                        {t.n}
                      </td>
                      <td style={{ textAlign: "left" }} className="num muted">
                        {f.size}
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {who ? (
                          <span className="row">
                            <Av member={who} />
                            {who.name}
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "left" }} className="muted">
                        {f.at ? activityTimeAgo(f.at) : "—"}
                      </td>
                      <td>{removeBtn(f, "ibtn ibtn-sm", 14)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** gr8r `filePrev` — a little page / sheet / image sketch + the extension tag. */
function FilePreview({ kind, name }: { kind: FKind; name: string }) {
  const t = FT[kind];
  let art: React.ReactNode;
  if (kind === "img")
    art = (
      <div
        className="art"
        style={{
          padding: 0,
          overflow: "hidden",
          background: `linear-gradient(135deg, color-mix(in srgb, ${t.c} 35%, var(--g8-surface)), color-mix(in srgb, ${t.c} 10%, var(--g8-surface)))`,
        }}
      >
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <path d="M0 60 L30 28 L52 46 L70 32 L100 58 L100 60Z" fill={`color-mix(in srgb, ${t.c} 45%, var(--g8-surface))`} />
          <circle cx="76" cy="16" r="7" fill={`color-mix(in srgb, ${t.c} 30%, var(--g8-surface))`} />
        </svg>
      </div>
    );
  else if (kind === "sheet")
    art = (
      <div className="art" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    );
  else if (kind === "zip")
    art = (
      <div style={{ color: t.c }}>
        <Gi icon={FileArchive} size={30} />
      </div>
    );
  else
    art = (
      <div className="art">
        <i className="h" />
        <i />
        <i />
        <i style={{ width: "80%" }} />
        <i />
        <i style={{ width: "60%" }} />
      </div>
    );
  const ext = kind === "page" ? "doc" : (name.split(".").pop() || "").slice(0, 4);
  return (
    <div className="fprev">
      {art}
      <span className="ext" style={{ "--g8-c": t.c } as CSSVars}>
        {ext}
      </span>
    </div>
  );
}

/**
 * Upload one object to the private `project-files` bucket through Storage's
 * REST endpoint, reporting progress (0–100). Same auth as supabase-js: the
 * user's access token + the publishable key; the bucket's RLS decides.
 */
function putWithProgress(
  path: string,
  file: File,
  token: string,
  onPct: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/project-files/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = (JSON.parse(xhr.responseText) as { message?: string }).message ?? msg;
        } catch {
          // keep the status message
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}
