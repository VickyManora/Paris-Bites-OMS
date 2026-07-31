import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Banknote,
  Bell,
  BellOff,
  Bike,
  Boxes,
  CakeSlice,
  CalendarDays,
  CalendarX,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  CircleX,
  Clock,
  CloudOff,
  Command,
  CornerDownLeft,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Inbox,
  Info,
  Keyboard,
  KeyRound,
  Lock,
  ListChecks,
  LayoutDashboard,
  LogOut,
  Minus,
  Monitor,
  Moon,
  Package,
  PackageMinus,
  PanelLeft,
  PanelLeftClose,
  Percent,
  Plus,
  QrCode,
  Receipt,
  ReceiptText,
  RefreshCw,
  Rows2,
  Rows3,
  Search,
  SearchX,
  Star,
  SlidersHorizontal,
  Split,
  SquarePen,
  Store,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  User,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIconData,
} from 'lucide-angular';

/**
 * The icon vocabulary, as names this app chose rather than names a library chose.
 *
 * Every icon the shell can draw is registered here, and call sites name the **thing**, not the
 * glyph: `<pb-icon name="inventory" />`, never `<pb-icon name="package" />`. Two reasons, and the
 * second is the one that matters.
 *
 * The obvious reason is swapability — changing which glyph means "transfers" is a one-line edit
 * here rather than a search across the shell.
 *
 * The real reason is that **importing icons individually is what keeps them out of the bundle**.
 * `lucide-angular` ships roughly 1,600 icons; importing the barrel and passing a string name pulls
 * in the lot. Named imports let the bundler drop everything unreferenced, so the icon set costs
 * what this app actually uses and nothing more. A registry makes that the default rather than
 * something each component has to remember.
 *
 * Adding an icon means adding an import and a line below. That friction is deliberate: it is the
 * moment to ask whether an existing name already means this, which is how a set of forty icons
 * stays a set of forty rather than becoming ninety with four different arrows.
 */
export const PB_ICONS = {
  // --- Navigation -----------------------------------------------------------
  dashboard: LayoutDashboard,
  inventory: Package,
  transfers: ArrowLeftRight,
  consumption: UtensilsCrossed,
  purchases: ReceiptText,
  suppliers: Truck,
  pos: Store,
  sales: Banknote,
  analytics: ChartLine,
  reports: ChartColumn,
  notifications: Bell,
  profile: User,
  password: KeyRound,

  // --- Shell chrome ---------------------------------------------------------
  /** Opens the drawer on mobile and toggles the rail on desktop. */
  menu: PanelLeft,
  menuClose: PanelLeftClose,
  collapse: ChevronLeft,
  expand: ChevronRight,
  /*
   * The same glyph as `expand`, under the name the call site means.
   *
   * A breadcrumb separator is not an expand affordance, and `name="expand"` in a trail would read
   * as a bug to the next person. Two names for one drawing is what a registry is for.
   */
  chevronRight: ChevronRight,
  search: Search,
  searchEmpty: SearchX,
  close: X,
  add: Plus,
  check: Check,
  signOut: LogOut,

  // --- Appearance -----------------------------------------------------------
  themeLight: Sun,
  themeDark: Moon,
  themeSystem: Monitor,

  // --- Keyboard and palette -------------------------------------------------
  command: Command,
  keyboard: Keyboard,
  enter: CornerDownLeft,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  densityCompact: Rows3,
  densityComfortable: Rows2,

  // --- Notification states --------------------------------------------------
  notificationsOff: BellOff,
  offline: CloudOff,

  // --- Dashboard ------------------------------------------------------------
  //
  // Named for what the figure *is* rather than for the glyph, so a tile saying "inventory value"
  // asks for `value` and does not have to know that today that draws a wallet.
  revenue: Banknote,
  value: Wallet,
  spend: Receipt,
  tax: Percent,
  calendar: CalendarDays,
  cash: Wallet,
  platforms: Bike,
  product: CakeSlice,
  document: FileText,
  clock: Clock,
  pending: ListChecks,
  tasks: ListChecks,
  activity: Activity,
  health: Activity,
  categories: Boxes,
  qr: QrCode,
  split: Split,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
  edit: SquarePen,
  refresh: RefreshCw,
  download: Download,
  exportPdf: FileDown,
  exportExcel: FileSpreadsheet,
  locked: Lock,
  leaderboard: Trophy,
  donut: ChartPie,
  forward: ArrowRight,

  // Status marks used outside the tone system — a task's severity, a reconciliation line.
  ok: CircleCheck,
  dash: Minus,
  featured: Star,
  warning: TriangleAlert,
  critical: CircleAlert,
  info: Info,

  // Stock ledger actions, for the activity feed.
  movedIn: ArrowDownLeft,
  movedOut: ArrowUpRight,
  created: CirclePlus,
  deleted: Trash2,
  adjusted: SlidersHorizontal,

  // --- Notification types ---------------------------------------------------
  //
  // These back the server-sent names below. Registered under their own meanings so the shell can
  // also use them directly.
  transferRequested: Inbox,
  transferApproved: Truck,
  transferRejected: CircleX,
  transferCompleted: CircleCheck,
  lowStock: PackageMinus,
  purchaseCompleted: ReceiptText,
  expiryAlert: CalendarX,
} as const satisfies Record<string, LucideIconData>;

/** Every icon name the app knows. */
export type PbIconName = keyof typeof PB_ICONS;

/**
 * Server-sent Material icon names, translated to this vocabulary.
 *
 * **The notification API sends `icon` as a Material Symbols name** — `'production_quantity_limits'`,
 * `'task_alt'` — derived server-side from the notification type so every client draws the same
 * thing. That is an API contract, and this redesign does not touch APIs, so the translation happens
 * here instead.
 *
 * Keyed on the exact strings `TYPE_ICONS` in `notification.enum.ts` produces. If the server adds a
 * type, its icon arrives unmapped and `iconForServerName` falls back rather than rendering nothing —
 * a new notification type must still be readable on a client that predates it.
 */
const SERVER_ICON_ALIASES: Readonly<Record<string, PbIconName>> = {
  inbox: 'transferRequested',
  local_shipping: 'transferApproved',
  cancel: 'transferRejected',
  task_alt: 'transferCompleted',
  production_quantity_limits: 'lowStock',
  receipt_long: 'purchaseCompleted',
  event_busy: 'expiryAlert',
};

/**
 * Resolves a server-sent icon name, falling back to the generic bell.
 *
 * The fallback is the whole point of having this as a function: an unrecognised name means the
 * server knows about a notification type this build does not, and the correct response is to draw
 * *something* rather than to leave a hole where the icon goes.
 */
export function iconForServerName(name: string): PbIconName {
  return SERVER_ICON_ALIASES[name] ?? 'notifications';
}
