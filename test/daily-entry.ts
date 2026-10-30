/** 日记块测试用的入口：真 store + 真渲染函数 */
export { fps, makeStore, makeApp } from "./cmd-entry";
export { renderDaily, parseDailyOptions, dateFromPath, registerDailyBlocks } from "../src/views/daily";
export { Store } from "../src/store";
export { inPeriod, saturation, workloadBreakdown, todayISO } from "../src/data";
export { TFile } from "obsidian";
