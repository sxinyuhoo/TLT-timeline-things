/** i18n 验收用的环境：英文数据 + 真视图 + 真设置页 */
import { App } from "obsidian";
import { Store, TLTSettings } from "../src/store";
import { makeApp } from "./cmd-entry";

export { fps, makeApp } from "./cmd-entry";

export const SETTINGS: TLTSettings = {
  root: "",
  tasksFolder: "TLT/tasks",
  teamFolder: "TLT/crew",
  feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs",
  ideasFile: "TLT/ideas.md",
  tagsFile: "TLT/tags.md",
  defaultPeriod: "m",
  mineFeed: "My feed",
  feedIds: {},
  feedNames: {},
} as TLTSettings;

export async function makeStore(settings: Partial<TLTSettings> = {}) {
  const app = makeApp();
  const store = new Store(app, { ...SETTINGS, ...settings });
  await store.ensureVault();
  await store.load();
  return { app, store };
}

export { WorkbenchView } from "../src/views/workbench";
export { MessagesView } from "../src/views/messages";
export { TLTSettingTab } from "../src/main";
export { setLanguage, t } from "../src/i18n";
export {
  QuickTaskModal, TaskModal, QuickLogModal, IdeaModal, MsgModal,
  AddStaffModal, StaffModal, MilestonePeekModal, PromptModal, LogModal, TaskPeekModal,
} from "../src/views/modals";
export { PickerModal, ConfirmModal } from "../src/views/picker";
export type { App };
