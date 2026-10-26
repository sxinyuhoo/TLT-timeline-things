/**
 * 快捷命令测试的环境搭建：假 vault + 真 Store + 真流程。
 * 被 test/commands.mjs 打包使用。
 */
import { TFile, TFolder } from "obsidian";
import { Store, TLTSettings } from "../src/store";

/** 共享的假文件系统：测试之间用快照还原 */
export const fps: { files: Record<string, string> } = { files: {} };

const folders = new Set<string>();
folders.add("TLT");
["tasks", "crew", "feeds", "logs", "archive"].forEach((d) => folders.add(`TLT/${d}`));

export function makeApp() {
  const vault = {
    getMarkdownFiles: () => Object.keys(fps.files).map((p) => new TFile(p)),
    getAllLoadedFiles: () => [...folders].map((p) => new TFolder(p)),
    adapter: {
      exists: async (p: string) => p in fps.files || folders.has(p),
      read: async (p: string) => fps.files[p] ?? "",
      write: async (p: string, c: string) => { fps.files[p] = c; },
      mkdir: async () => {},
      remove: async () => {},
    },
    cachedRead: async (f: TFile) => fps.files[f.path] ?? "",
    getAbstractFileByPath: (p: string) => (p in fps.files ? new TFile(p) : folders.has(p) ? new TFolder(p) : null),
    process: async (f: TFile, fn: (d: string) => string) => { fps.files[f.path] = fn(fps.files[f.path]); },
    create: async (p: string, c: string) => {
      if (p in fps.files) throw new Error("File already exists.");
      fps.files[p] = c;
    },
    createFolder: async (p: string) => { folders.add(p); },
    trashFile: async (f: TFile) => { delete fps.files[f.path]; },
    on: () => ({}),
    getName: () => "测试库",
  };
  const fmOf = (path: string) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fps.files[path] || "");
    if (!m) return {};
    const out: Record<string, unknown> = {};
    for (const ln of m[1].split("\n")) {
      const i = ln.indexOf(":");
      if (i < 0) continue;
      const k = ln.slice(0, i).trim(), v = ln.slice(i + 1).trim();
      out[k] = v === "true" ? true : v === "false" ? false : v;
    }
    return out;
  };
  return {
    vault,
    metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: fmOf(f.path) }) },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({}),
      getActiveFile: () => null,
      revealLeaf: async () => {},
      setActiveLeaf: () => {},
    },
    fileManager: {
      renameFile: async (f: TFile, to: string) => {
        if (f && f.path in fps.files) { fps.files[to] = fps.files[f.path]; delete fps.files[f.path]; }
      },
      trashFile: async (f: TFile) => { delete fps.files[f.path]; },
    },
  } as unknown as import("obsidian").App;
}

export const SETTINGS: TLTSettings = {
  root: "",
  tasksFolder: "TLT/tasks",
  teamFolder: "TLT/crew",
  feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs",
  ideasFile: "TLT/ideas.md",
  tagsFile: "TLT/tags.md",
  defaultPeriod: "m",
  mineFeed: "我的动态",
  feedIds: {},
  feedNames: {},
} as TLTSettings;

export async function makeStore() {
  const app = makeApp();
  const store = new Store(app, { ...SETTINGS });
  await store.ensureVault();
  await store.load();
  return { app, store, refresh: () => store.load() };
}

export { PickerModal, ConfirmModal } from "../src/views/picker";
export { TLTPlugin } from "../src/main";
export {
  taskRegisterFlow, newProjectFlow, newMilestoneFlow, deleteTaskFlow,
  archiveProjectFlow, quickMenuFlow, quickIdeaFlow, newMessageFlow,
} from "../src/actions";
