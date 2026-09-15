// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryEditor } from "../../src/components/InventoryEditor";
import type { InboundEntry, InventorySnapshot } from "../../src/domain/planning";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const snapshots: InventorySnapshot[] = [
  { key: "inventory:2026-11-20:L", date: "2026-11-20", size: "L", fbaAvailable: 20, reserved: 2, unfulfillable: 1, sourceImportKey: "import:old" },
  { key: "inventory:2026-11-24:L", date: "2026-11-24", size: "L", fbaAvailable: 18, reserved: null, unfulfillable: 0, sourceImportKey: "import:new" },
  { key: "inventory:2026-11-23:XL", date: "2026-11-23", size: "XL", fbaAvailable: 15, reserved: 1, unfulfillable: null, sourceImportKey: "import:new" },
];
const inbound: InboundEntry[] = [
  { size: "L", units: null, expectedArrivalDate: null, updatedAt: "2026-11-20T00:00:00.000Z" },
  { size: "XL", units: 10, expectedArrivalDate: "2026-11-28", updatedAt: "2026-11-20T00:00:00.000Z" },
];

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

test("renders four accessible size rows using each size's latest snapshot", () => {
  render(<InventoryEditor inventory={snapshots} inbound={inbound} updatedAt="2026-11-25T08:00:00.000Z" />);
  const snapshotTable = screen.getByRole("table", { name: "Inventory snapshot reference" });

  expect(within(snapshotTable).getAllByRole("row")).toHaveLength(5);
  expect(within(snapshotTable).getByRole("row", { name: /L 2026-11-24 18/ })).toBeTruthy();
  expect(within(snapshotTable).getByRole("row", { name: /XL 2026-11-23 15/ })).toBeTruthy();
  expect(screen.queryByLabelText("L inbound units")).toBeNull();
  expect(screen.queryByLabelText("L expected arrival date")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save L inbound" })).toBeNull();
});

test("rejects negative and fractional units and invalid ISO calendar dates", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  render(<InventoryEditor inventory={snapshots} inbound={inbound} updatedAt="2026-11-25T08:00:00.000Z" locale="zh" />);
  const units = screen.getByLabelText("数量");
  const date = screen.getByLabelText("到货时间");
  const save = screen.getByRole("button", { name: "保存发货明细" });

  fireEvent.change(units, { target: { value: "-1" } });
  fireEvent.click(save);
  expect(screen.getByRole("alert").textContent).toContain("FBA单号不能为空");

  fireEvent.change(screen.getByLabelText("FBA单号"), { target: { value: "FBA1" } });
  fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "SKU-L" } });
  fireEvent.change(units, { target: { value: "1.5" } });
  fireEvent.click(save);
  expect(screen.getByRole("alert").textContent).toContain("数量必须是非负整数");

  fireEvent.change(units, { target: { value: "2" } });
  fireEvent.change(date, { target: { value: "2026-02-30" } });
  fireEvent.click(save);
  expect(screen.getByRole("alert").textContent).toContain("到货时间必须是有效日期");
  expect(await opsDb.getInboundEntries()).toEqual([]);
});

test("records FBA shipment lines and summarizes inbound units by SKU", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  render(<InventoryEditor inventory={[]} inbound={[]} updatedAt="2026-09-10T08:00:00.000Z" locale="zh" />);

  fireEvent.change(screen.getByLabelText("FBA单号"), { target: { value: "FBA19MSY9TRD" } });
  fireEvent.change(screen.getByLabelText("单价"), { target: { value: "13.3/KG" } });
  fireEvent.change(screen.getByLabelText("ASIN"), { target: { value: "B0CFPR34MH" } });
  fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "A022-XXX-09-0B500" } });
  fireEvent.change(screen.getByLabelText("品名"), { target: { value: "XL码 5JUN-RD 圣诞服9件套" } });
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "15" } });
  fireEvent.change(screen.getByLabelText("开船时间"), { target: { value: "2026-09-10" } });
  fireEvent.change(screen.getByLabelText("到货时间"), { target: { value: "2026-10-05" } });
  fireEvent.click(screen.getByRole("button", { name: "保存发货明细" }));

  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("发货明细已保存"));
  expect(within(screen.getByRole("table", { name: "SKU在途汇总" })).getByRole("row", { name: /A022-XXX-09-0B500 XL码 5JUN-RD 圣诞服9件套 15/ })).toBeTruthy();

  fireEvent.change(screen.getByLabelText("FBA单号"), { target: { value: "FBA19NJ9VY3C" } });
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "保存发货明细" }));
  await waitFor(() => expect(within(screen.getByRole("table", { name: "SKU在途汇总" })).getByRole("row", { name: /A022-XXX-09-0B500 XL码 5JUN-RD 圣诞服9件套 55/ })).toBeTruthy());
  expect(within(screen.getByRole("table", { name: "SKU在途汇总" })).getByRole("row", { name: /所有尺码合计 55/ })).toBeTruthy();

  expect(within(screen.getByRole("table", { name: "发货明细" })).getAllByRole("row").map((row) => row.textContent).join(" ")).toContain("B0CFPR34MH");
  expect(await opsDb.getInboundEntries()).toMatchObject([
    { fbaNumber: "FBA19MSY9TRD", asin: "B0CFPR34MH", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", units: 15, size: "XL", shipDate: "2026-09-10", expectedArrivalDate: "2026-10-05" },
    { fbaNumber: "FBA19NJ9VY3C", asin: "B0CFPR34MH", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", units: 40, size: "XL", shipDate: "2026-09-10", expectedArrivalDate: "2026-10-05" },
  ]);
});

test("summarizes inbound quantities by arrival date and product name", () => {
  const shipmentLines: InboundEntry[] = [
    { size: "XL", units: 20, expectedArrivalDate: "2026-09-03", updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA1", sku: "XL-1", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-01" },
    { size: "XL", units: 30, expectedArrivalDate: "2026-09-03", updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA2", sku: "XL-1", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-02" },
    { size: "L", units: 30, expectedArrivalDate: "2026-09-03", updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA3", sku: "L-1", productName: "L码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-02" },
    { size: "2XL", units: 10, expectedArrivalDate: null, updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA4", sku: "2XL-1", productName: "XXL码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-03" },
  ];

  render(<InventoryEditor inventory={[]} inbound={shipmentLines} updatedAt="2026-09-10T08:00:00.000Z" locale="zh" />);
  const table = screen.getByRole("table", { name: "到货节奏汇总" });

  expect(within(table).getByRole("row", { name: /2026-09-03/ }).textContent).toContain("XL码 5JUN-RD 圣诞服9件套50");
  expect(within(table).getByRole("row", { name: /2026-09-03/ }).textContent).toContain("L码 5JUN-RD 圣诞服9件套30");
  expect(within(table).getByRole("row", { name: /未填写到货时间/ }).textContent).toContain("XXL码 5JUN-RD 圣诞服9件套10");
});

test("loads arrival summary from the latest saved shipment data", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  await opsDb.saveInboundEntry({ size: "XL", units: 50, expectedArrivalDate: "2026-09-03", updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA-LATEST-XL", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-25" });
  await opsDb.saveInboundEntry({ size: "L", units: 30, expectedArrivalDate: "2026-09-03", updatedAt: "2026-09-01T00:00:00.000Z", fbaNumber: "FBA-LATEST-L", sku: "A022-XXX-09-0C100", productName: "L码 5JUN-RD 圣诞服9件套", shipDate: "2026-08-25" });

  render(<InventoryEditor inventory={[]} inbound={[]} updatedAt="2026-09-10T08:00:00.000Z" locale="zh" />);

  const table = screen.getByRole("table", { name: "到货节奏汇总" });
  await waitFor(() => expect(within(table).getByRole("row", { name: /2026-09-03/ }).textContent).toContain("XL码 5JUN-RD 圣诞服9件套50"));
  expect(within(table).getByRole("row", { name: /2026-09-03/ }).textContent).toContain("L码 5JUN-RD 圣诞服9件套30");
});

test("removes shipment lines when received or deleted", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  const shipmentLines: InboundEntry[] = [
    { size: "XL", units: 15, expectedArrivalDate: "2026-10-05", updatedAt: "2026-09-10T00:00:00.000Z", fbaNumber: "FBA19MSY9TRD", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-09-10" },
    { size: "L", units: 30, expectedArrivalDate: "2026-10-05", updatedAt: "2026-09-10T00:00:00.000Z", fbaNumber: "FBA19DEL", sku: "A022-XXX-09-0C100", productName: "L码 5JUN-RD 圣诞服9件套", shipDate: "2026-09-10" },
  ];
  for (const entry of shipmentLines) await opsDb.saveInboundEntry(entry);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<InventoryEditor inventory={[]} inbound={shipmentLines} updatedAt="2026-09-10T08:00:00.000Z" locale="zh" />);
  fireEvent.click(screen.getByRole("button", { name: "收到 FBA19MSY9TRD A022-XXX-09-0B500" }));
  await waitFor(() => expect(screen.queryByText("FBA19MSY9TRD")).toBeNull());
  expect(within(screen.getByRole("table", { name: "SKU在途汇总" })).queryByRole("row", { name: /A022-XXX-09-0B500/ })).toBeNull();
  expect(within(screen.getByRole("table", { name: "到货节奏汇总" })).queryByText("XL码 5JUN-RD 圣诞服9件套")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "删除 FBA19DEL A022-XXX-09-0C100" }));
  await waitFor(() => expect(screen.queryByText("FBA19DEL")).toBeNull());
  expect(screen.getByRole("table", { name: "到货节奏汇总" }).textContent).toContain("暂无到货节奏数据");
  expect(await opsDb.getInboundEntries()).toEqual([]);
  expect(confirm).toHaveBeenCalledTimes(2);
});
