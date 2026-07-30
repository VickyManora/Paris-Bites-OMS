import type { PrismaClient } from '../../generated/prisma/client.js';
import type { IHashService } from '../../core/application/ports/hash.service.port.js';
import type { ILogger } from '../../core/application/ports/logger.port.js';
import type { ITokenService } from '../../core/application/ports/token.service.port.js';
import type { IAuditLogRepository } from '../../core/domain/repositories/audit-log.repository.js';
import type { IRefreshTokenRepository } from '../../core/domain/repositories/refresh-token.repository.js';
import type { IUserRepository } from '../../core/domain/repositories/user.repository.js';
import { ChangePasswordUseCase } from '../../core/application/use-cases/auth/change-password.use-case.js';
import { GetCurrentUserUseCase } from '../../core/application/use-cases/auth/get-current-user.use-case.js';
import { LoginUseCase } from '../../core/application/use-cases/auth/login.use-case.js';
import {
  LogoutAllSessionsUseCase,
  LogoutUseCase,
} from '../../core/application/use-cases/auth/logout.use-case.js';
import { RefreshTokenUseCase } from '../../core/application/use-cases/auth/refresh-token.use-case.js';
import { AdjustInventoryQuantityUseCase } from '../../core/application/use-cases/inventory/adjust-inventory-quantity.use-case.js';
import {
  RecordConsumptionUseCase,
  UpdateConsumptionUseCase,
  VoidConsumptionUseCase,
} from '../../core/application/use-cases/consumption/manage-consumption.use-case.js';
import {
  GetConsumptionSummaryUseCase,
  GetConsumptionUseCase,
  ListConsumptionUseCase,
} from '../../core/application/use-cases/consumption/read-consumption.use-case.js';
import type { IConsumptionRepository } from '../../core/domain/repositories/consumption.repository.js';
import { ConsumptionPrismaRepository } from '../database/repositories/consumption.prisma-repository.js';
import {
  ExportReportUseCase,
  ListReportsUseCase,
  RunReportUseCase,
} from '../../core/application/use-cases/reports/run-report.use-case.js';
import type { IReportRepository } from '../../core/domain/repositories/report.repository.js';
import type { IReportExporter } from '../../core/application/ports/report-exporter.port.js';
import { ReportPrismaRepository } from '../database/repositories/report.prisma-repository.js';
import { ExcelReportExporter } from '../reporting/excel-report.exporter.js';
import { PdfReportExporter } from '../reporting/pdf-report.exporter.js';
import { GetDashboardUseCase } from '../../core/application/use-cases/dashboard/get-dashboard.use-case.js';
import type { IDashboardRepository } from '../../core/domain/repositories/dashboard.repository.js';
import { DashboardPrismaRepository } from '../database/repositories/dashboard.prisma-repository.js';
import { CreateInventoryItemUseCase } from '../../core/application/use-cases/inventory/create-inventory-item.use-case.js';
import { DeleteInventoryItemUseCase } from '../../core/application/use-cases/inventory/delete-inventory-item.use-case.js';
import { GetInventoryHistoryUseCase } from '../../core/application/use-cases/inventory/get-inventory-history.use-case.js';
import { GetInventoryItemUseCase } from '../../core/application/use-cases/inventory/get-inventory-item.use-case.js';
import { GetInventoryDashboardUseCase } from '../../core/application/use-cases/inventory/get-inventory-summary.use-case.js';
import { ListInventoryItemsUseCase } from '../../core/application/use-cases/inventory/list-inventory-items.use-case.js';
import { UpdateInventoryItemUseCase } from '../../core/application/use-cases/inventory/update-inventory-item.use-case.js';
import type { IInventoryItemHistoryRepository } from '../../core/domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemRepository } from '../../core/domain/repositories/inventory-item.repository.js';
import type { IFileStorage } from '../../core/application/ports/file-storage.port.js';
import type { INotificationRepository } from '../../core/domain/repositories/notification.repository.js';
import type { IPurchaseRepository } from '../../core/domain/repositories/purchase.repository.js';
import type { ISupplierRepository } from '../../core/domain/repositories/supplier.repository.js';
import {
  CreateSupplierUseCase,
  DeleteSupplierUseCase,
  UpdateSupplierUseCase,
} from '../../core/application/use-cases/suppliers/manage-suppliers.use-case.js';
import {
  GetSupplierUseCase,
  ListSupplierOptionsUseCase,
  ListSuppliersUseCase,
} from '../../core/application/use-cases/suppliers/read-suppliers.use-case.js';
import { RecordPurchaseUseCase } from '../../core/application/use-cases/purchases/record-purchase.use-case.js';
import {
  DownloadPurchaseInvoiceUseCase,
  UploadPurchaseInvoiceUseCase,
} from '../../core/application/use-cases/purchases/manage-purchase-invoice.use-case.js';
import {
  GetPurchaseSummaryUseCase,
  GetPurchaseUseCase,
  ListPurchasesUseCase,
} from '../../core/application/use-cases/purchases/read-purchases.use-case.js';
import type { IStockTransferRepository } from '../../core/domain/repositories/stock-transfer.repository.js';
import {
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
} from '../../core/application/use-cases/notifications/mark-notifications-read.use-case.js';
import {
  GetNotificationFeedUseCase,
  GetUnreadNotificationCountUseCase,
  ListNotificationsUseCase,
} from '../../core/application/use-cases/notifications/read-notifications.use-case.js';
import { TransferNotifier } from '../../core/application/use-cases/transfers/transfer-notifier.js';
import { ApproveStockTransferUseCase } from '../../core/application/use-cases/transfers/approve-stock-transfer.use-case.js';
import { CompleteStockTransferUseCase } from '../../core/application/use-cases/transfers/complete-stock-transfer.use-case.js';
import { CreateStockTransferUseCase } from '../../core/application/use-cases/transfers/create-stock-transfer.use-case.js';
import {
  GetStockTransferUseCase,
  GetTransferSummaryUseCase,
  ListStockTransfersUseCase,
} from '../../core/application/use-cases/transfers/read-stock-transfers.use-case.js';
import { RejectStockTransferUseCase } from '../../core/application/use-cases/transfers/reject-stock-transfer.use-case.js';
import { env } from '../../config/env.js';
import { prisma } from '../database/prisma.client.js';
import { AuditLogPrismaRepository } from '../database/repositories/audit-log.prisma-repository.js';
import { InventoryItemHistoryPrismaRepository } from '../database/repositories/inventory-item-history.prisma-repository.js';
import { InventoryItemPrismaRepository } from '../database/repositories/inventory-item.prisma-repository.js';
import { PurchaseNotifier } from '../../core/application/use-cases/purchases/purchase-notifier.js';
import { StockAlertScanner } from '../../core/application/use-cases/notifications/stock-alert-scanner.js';
import {
  RecordDailySalesUseCase,
  UpdateDailySalesUseCase,
} from '../../core/application/use-cases/sales/manage-daily-sales.use-case.js';
import {
  GetDailySalesByDateUseCase,
  GetDailySalesSummaryUseCase,
  GetDailySalesUseCase,
  ListDailySalesUseCase,
} from '../../core/application/use-cases/sales/read-daily-sales.use-case.js';
import type { IDailySalesRepository } from '../../core/domain/repositories/daily-sales.repository.js';
import type { IAnalyticsRepository } from '../../core/domain/repositories/analytics.repository.js';
import type {
  IPosOrderRepository,
  IProductRepository,
} from '../../core/domain/repositories/pos.repository.js';
import {
  CancelOrderUseCase,
  PlaceOrderUseCase,
  ReceivePaymentUseCase,
} from '../../core/application/use-cases/pos/manage-orders.use-case.js';
import {
  GetMenuUseCase,
  GetOrderUseCase,
  GetPosSummaryUseCase,
  ListOrdersUseCase,
} from '../../core/application/use-cases/pos/read-orders.use-case.js';
import { PosOrderPrismaRepository } from '../database/repositories/pos-order.prisma-repository.js';
import { ProductPrismaRepository } from '../database/repositories/product.prisma-repository.js';
import type { IAnalyticsExporter } from '../../core/application/ports/analytics-exporter.port.js';
import { GetAnalyticsUseCase } from '../../core/application/use-cases/analytics/get-analytics.use-case.js';
import { AnalyticsPrismaRepository } from '../database/repositories/analytics.prisma-repository.js';
import { ExcelAnalyticsExporter } from '../reporting/excel-analytics.exporter.js';
import { PdfAnalyticsExporter } from '../reporting/pdf-analytics.exporter.js';
import { DailySalesPrismaRepository } from '../database/repositories/daily-sales.prisma-repository.js';
import { NotificationPrismaRepository } from '../database/repositories/notification.prisma-repository.js';
import { PurchasePrismaRepository } from '../database/repositories/purchase.prisma-repository.js';
import { SupplierPrismaRepository } from '../database/repositories/supplier.prisma-repository.js';
import { LocalFileStorage } from '../storage/local-file.storage.js';
import { StockTransferPrismaRepository } from '../database/repositories/stock-transfer.prisma-repository.js';
import { RefreshTokenPrismaRepository } from '../database/repositories/refresh-token.prisma-repository.js';
import { UserPrismaRepository } from '../database/repositories/user.prisma-repository.js';
import { createPinoInstance, PinoLogger } from '../logging/pino-logger.js';
import { BcryptHashService } from '../security/bcrypt-hash.service.js';
import { JwtTokenService } from '../security/jwt-token.service.js';

/**
 * Everything the presentation layer is allowed to reach for.
 *
 * Services are declared as interfaces so controllers depend on abstractions and a
 * test can substitute an in-memory implementation for any entry. Use cases are
 * concrete classes: they *are* the abstraction, and each already depends only on
 * ports.
 */
export interface AppContainer {
  readonly prisma: PrismaClient;
  readonly logger: ILogger;

  readonly hashService: IHashService;
  readonly tokenService: ITokenService;

  readonly userRepository: IUserRepository;
  readonly refreshTokenRepository: IRefreshTokenRepository;
  readonly auditLogRepository: IAuditLogRepository;
  readonly inventoryItemRepository: IInventoryItemRepository;
  readonly inventoryHistoryRepository: IInventoryItemHistoryRepository;
  readonly stockTransferRepository: IStockTransferRepository;
  readonly notificationRepository: INotificationRepository;
  readonly dailySalesRepository: IDailySalesRepository;
  readonly analyticsRepository: IAnalyticsRepository;
  readonly posOrderRepository: IPosOrderRepository;
  readonly productRepository: IProductRepository;
  readonly analyticsExporters: readonly IAnalyticsExporter[];
  readonly supplierRepository: ISupplierRepository;
  readonly consumptionRepository: IConsumptionRepository;
  readonly dashboardRepository: IDashboardRepository;
  readonly reportRepository: IReportRepository;
  readonly reportExporters: readonly IReportExporter[];
  readonly purchaseRepository: IPurchaseRepository;

  /** Local disk today. See `IFileStorage` for why this is the only line S3 would change. */
  readonly fileStorage: IFileStorage;

  /**
   * Not a use case: a collaborator the transfer use cases call after their own work is
   * done. Exposed here so a test can substitute a spy and assert who was notified.
   */
  readonly transferNotifier: TransferNotifier;
  readonly purchaseNotifier: PurchaseNotifier;
  /** Exposed so the scheduler — and a test — can run a sweep without a request. */
  readonly stockAlertScanner: StockAlertScanner;

  readonly loginUseCase: LoginUseCase;
  readonly refreshTokenUseCase: RefreshTokenUseCase;
  readonly logoutUseCase: LogoutUseCase;
  readonly logoutAllSessionsUseCase: LogoutAllSessionsUseCase;
  readonly getCurrentUserUseCase: GetCurrentUserUseCase;
  readonly changePasswordUseCase: ChangePasswordUseCase;

  readonly listInventoryItemsUseCase: ListInventoryItemsUseCase;
  readonly getInventoryItemUseCase: GetInventoryItemUseCase;
  readonly getDashboardUseCase: GetDashboardUseCase;
  readonly listReportsUseCase: ListReportsUseCase;
  readonly runReportUseCase: RunReportUseCase;
  readonly exportReportUseCase: ExportReportUseCase;
  readonly listConsumptionUseCase: ListConsumptionUseCase;
  readonly getConsumptionSummaryUseCase: GetConsumptionSummaryUseCase;
  readonly getConsumptionUseCase: GetConsumptionUseCase;
  readonly recordConsumptionUseCase: RecordConsumptionUseCase;
  readonly updateConsumptionUseCase: UpdateConsumptionUseCase;
  readonly voidConsumptionUseCase: VoidConsumptionUseCase;
  readonly createInventoryItemUseCase: CreateInventoryItemUseCase;
  readonly updateInventoryItemUseCase: UpdateInventoryItemUseCase;
  readonly adjustInventoryQuantityUseCase: AdjustInventoryQuantityUseCase;
  readonly deleteInventoryItemUseCase: DeleteInventoryItemUseCase;
  readonly getInventoryHistoryUseCase: GetInventoryHistoryUseCase;
  readonly getInventoryDashboardUseCase: GetInventoryDashboardUseCase;

  readonly listStockTransfersUseCase: ListStockTransfersUseCase;
  readonly getStockTransferUseCase: GetStockTransferUseCase;
  readonly getTransferSummaryUseCase: GetTransferSummaryUseCase;
  readonly createStockTransferUseCase: CreateStockTransferUseCase;
  readonly approveStockTransferUseCase: ApproveStockTransferUseCase;
  readonly rejectStockTransferUseCase: RejectStockTransferUseCase;
  readonly completeStockTransferUseCase: CompleteStockTransferUseCase;

  readonly getAnalyticsUseCase: GetAnalyticsUseCase;

  readonly getMenuUseCase: GetMenuUseCase;
  readonly getPosSummaryUseCase: GetPosSummaryUseCase;
  readonly listOrdersUseCase: ListOrdersUseCase;
  readonly getOrderUseCase: GetOrderUseCase;
  readonly placeOrderUseCase: PlaceOrderUseCase;
  readonly receivePaymentUseCase: ReceivePaymentUseCase;
  readonly cancelOrderUseCase: CancelOrderUseCase;

  readonly listDailySalesUseCase: ListDailySalesUseCase;
  readonly getDailySalesSummaryUseCase: GetDailySalesSummaryUseCase;
  readonly getDailySalesUseCase: GetDailySalesUseCase;
  readonly getDailySalesByDateUseCase: GetDailySalesByDateUseCase;
  readonly recordDailySalesUseCase: RecordDailySalesUseCase;
  readonly updateDailySalesUseCase: UpdateDailySalesUseCase;

  readonly listNotificationsUseCase: ListNotificationsUseCase;
  readonly getNotificationFeedUseCase: GetNotificationFeedUseCase;
  readonly getUnreadNotificationCountUseCase: GetUnreadNotificationCountUseCase;
  readonly markNotificationReadUseCase: MarkNotificationReadUseCase;
  readonly markAllNotificationsReadUseCase: MarkAllNotificationsReadUseCase;

  readonly listSuppliersUseCase: ListSuppliersUseCase;
  readonly listSupplierOptionsUseCase: ListSupplierOptionsUseCase;
  readonly getSupplierUseCase: GetSupplierUseCase;
  readonly createSupplierUseCase: CreateSupplierUseCase;
  readonly updateSupplierUseCase: UpdateSupplierUseCase;
  readonly deleteSupplierUseCase: DeleteSupplierUseCase;

  readonly listPurchasesUseCase: ListPurchasesUseCase;
  readonly getPurchaseUseCase: GetPurchaseUseCase;
  readonly getPurchaseSummaryUseCase: GetPurchaseSummaryUseCase;
  readonly recordPurchaseUseCase: RecordPurchaseUseCase;
  readonly uploadPurchaseInvoiceUseCase: UploadPurchaseInvoiceUseCase;
  readonly downloadPurchaseInvoiceUseCase: DownloadPurchaseInvoiceUseCase;
}

/**
 * Composition root: the single place in the process that constructs concrete
 * classes.
 *
 * Manual construction is deliberate — the graph is explicit and readable, and it
 * avoids a decorator/reflection DI framework fighting strict ESM. `overrides`
 * exists so an integration test can swap a repository for a fake and drive the
 * real HTTP stack against it.
 */
export function createContainer(overrides: Partial<AppContainer> = {}): AppContainer {
  const client = overrides.prisma ?? prisma;
  const logger = overrides.logger ?? new PinoLogger(createPinoInstance());

  const hashService = overrides.hashService ?? new BcryptHashService(env.BCRYPT_SALT_ROUNDS);

  const tokenService =
    overrides.tokenService ??
    new JwtTokenService({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

  const userRepository = overrides.userRepository ?? new UserPrismaRepository(client);
  const refreshTokenRepository =
    overrides.refreshTokenRepository ?? new RefreshTokenPrismaRepository(client);
  const auditLogRepository =
    overrides.auditLogRepository ?? new AuditLogPrismaRepository(client, logger);
  const inventoryItemRepository =
    overrides.inventoryItemRepository ?? new InventoryItemPrismaRepository(client);
  const inventoryHistoryRepository =
    overrides.inventoryHistoryRepository ?? new InventoryItemHistoryPrismaRepository(client);
  const stockTransferRepository =
    overrides.stockTransferRepository ?? new StockTransferPrismaRepository(client);
  const notificationRepository =
    overrides.notificationRepository ?? new NotificationPrismaRepository(client, logger);

  const dailySalesRepository =
    overrides.dailySalesRepository ?? new DailySalesPrismaRepository(client);

  const analyticsRepository =
    overrides.analyticsRepository ?? new AnalyticsPrismaRepository(client);

  const posOrderRepository =
    overrides.posOrderRepository ?? new PosOrderPrismaRepository(client);
  const productRepository = overrides.productRepository ?? new ProductPrismaRepository(client);

  const analyticsExporters =
    overrides.analyticsExporters ?? [new ExcelAnalyticsExporter(), new PdfAnalyticsExporter()];

  const supplierRepository = overrides.supplierRepository ?? new SupplierPrismaRepository(client);
  const consumptionRepository =
    overrides.consumptionRepository ?? new ConsumptionPrismaRepository(client);
  const dashboardRepository = overrides.dashboardRepository ?? new DashboardPrismaRepository(client);
  const reportRepository = overrides.reportRepository ?? new ReportPrismaRepository(client);
  const reportExporters =
    overrides.reportExporters ?? [new ExcelReportExporter(), new PdfReportExporter()];
  const purchaseRepository = overrides.purchaseRepository ?? new PurchasePrismaRepository(client);

  const fileStorage = overrides.fileStorage ?? new LocalFileStorage(env.UPLOAD_DIR, logger);

  const transferNotifier =
    overrides.transferNotifier ??
    new TransferNotifier(notificationRepository, userRepository, logger);

  const purchaseNotifier = new PurchaseNotifier(notificationRepository, userRepository, logger);

  const stockAlertScanner =
    overrides.stockAlertScanner ??
    new StockAlertScanner(
      inventoryItemRepository,
      notificationRepository,
      userRepository,
      logger,
      {
        expiryWithinDays: env.EXPIRY_ALERT_DAYS,
        cooldownHours: env.ALERT_COOLDOWN_HOURS,
      },
    );

  return {
    prisma: client,
    logger,

    hashService,
    tokenService,

    userRepository,
    refreshTokenRepository,
    auditLogRepository,
    inventoryItemRepository,
    inventoryHistoryRepository,
    stockTransferRepository,
    notificationRepository,
    supplierRepository,
    consumptionRepository,
    dailySalesRepository,
    analyticsRepository,
    analyticsExporters,
    posOrderRepository,
    productRepository,
    dashboardRepository,
    reportRepository,
    reportExporters,
    purchaseRepository,

    fileStorage,
    transferNotifier,
    purchaseNotifier,
    stockAlertScanner,

    loginUseCase:
      overrides.loginUseCase ??
      new LoginUseCase(
        userRepository,
        refreshTokenRepository,
        hashService,
        tokenService,
        auditLogRepository,
        logger,
      ),

    refreshTokenUseCase:
      overrides.refreshTokenUseCase ??
      new RefreshTokenUseCase(
        userRepository,
        refreshTokenRepository,
        tokenService,
        auditLogRepository,
        logger,
      ),

    logoutUseCase:
      overrides.logoutUseCase ??
      new LogoutUseCase(refreshTokenRepository, tokenService, auditLogRepository, logger),

    logoutAllSessionsUseCase:
      overrides.logoutAllSessionsUseCase ??
      new LogoutAllSessionsUseCase(refreshTokenRepository, auditLogRepository, logger),

    getCurrentUserUseCase:
      overrides.getCurrentUserUseCase ?? new GetCurrentUserUseCase(userRepository),

    changePasswordUseCase:
      overrides.changePasswordUseCase ??
      new ChangePasswordUseCase(
        userRepository,
        refreshTokenRepository,
        hashService,
        auditLogRepository,
        logger,
      ),

    // --- Inventory ---------------------------------------------------------
    listInventoryItemsUseCase:
      overrides.listInventoryItemsUseCase ?? new ListInventoryItemsUseCase(inventoryItemRepository),

    getInventoryItemUseCase:
      overrides.getInventoryItemUseCase ?? new GetInventoryItemUseCase(inventoryItemRepository),

    listReportsUseCase: overrides.listReportsUseCase ?? new ListReportsUseCase(),
    runReportUseCase: overrides.runReportUseCase ?? new RunReportUseCase(reportRepository),
    exportReportUseCase:
      overrides.exportReportUseCase ??
      new ExportReportUseCase(reportRepository, reportExporters),

    getDashboardUseCase:
      overrides.getDashboardUseCase ??
      new GetDashboardUseCase(dashboardRepository, inventoryHistoryRepository),

    listConsumptionUseCase:
      overrides.listConsumptionUseCase ?? new ListConsumptionUseCase(consumptionRepository),
    getConsumptionSummaryUseCase:
      overrides.getConsumptionSummaryUseCase ??
      new GetConsumptionSummaryUseCase(consumptionRepository),
    getConsumptionUseCase:
      overrides.getConsumptionUseCase ?? new GetConsumptionUseCase(consumptionRepository),
    recordConsumptionUseCase:
      overrides.recordConsumptionUseCase ??
      new RecordConsumptionUseCase(consumptionRepository, auditLogRepository, logger),
    updateConsumptionUseCase:
      overrides.updateConsumptionUseCase ??
      new UpdateConsumptionUseCase(consumptionRepository, auditLogRepository, logger),
    voidConsumptionUseCase:
      overrides.voidConsumptionUseCase ??
      new VoidConsumptionUseCase(consumptionRepository, auditLogRepository, logger),

    createInventoryItemUseCase:
      overrides.createInventoryItemUseCase ??
      new CreateInventoryItemUseCase(
        inventoryItemRepository,
        inventoryHistoryRepository,
        supplierRepository,
        logger,
      ),

    updateInventoryItemUseCase:
      overrides.updateInventoryItemUseCase ??
      new UpdateInventoryItemUseCase(
        inventoryItemRepository,
        inventoryHistoryRepository,
        supplierRepository,
        logger,
      ),

    // Takes no history repository: the entry is written inside the same transaction as
    // the quantity change, by the item repository.
    adjustInventoryQuantityUseCase:
      overrides.adjustInventoryQuantityUseCase ??
      new AdjustInventoryQuantityUseCase(inventoryItemRepository, logger),

    deleteInventoryItemUseCase:
      overrides.deleteInventoryItemUseCase ??
      new DeleteInventoryItemUseCase(inventoryItemRepository, inventoryHistoryRepository, logger),

    getInventoryHistoryUseCase:
      overrides.getInventoryHistoryUseCase ??
      new GetInventoryHistoryUseCase(inventoryItemRepository, inventoryHistoryRepository),

    getInventoryDashboardUseCase:
      overrides.getInventoryDashboardUseCase ??
      new GetInventoryDashboardUseCase(inventoryItemRepository, inventoryHistoryRepository),

    // --- Stock transfers ---------------------------------------------------
    listStockTransfersUseCase:
      overrides.listStockTransfersUseCase ?? new ListStockTransfersUseCase(stockTransferRepository),

    getStockTransferUseCase:
      overrides.getStockTransferUseCase ?? new GetStockTransferUseCase(stockTransferRepository),

    getTransferSummaryUseCase:
      overrides.getTransferSummaryUseCase ?? new GetTransferSummaryUseCase(stockTransferRepository),

    createStockTransferUseCase:
      overrides.createStockTransferUseCase ??
      new CreateStockTransferUseCase(
        stockTransferRepository,
        inventoryItemRepository,
        auditLogRepository,
        transferNotifier,
        logger,
      ),

    approveStockTransferUseCase:
      overrides.approveStockTransferUseCase ??
      new ApproveStockTransferUseCase(
        stockTransferRepository,
        auditLogRepository,
        transferNotifier,
        logger,
      ),

    rejectStockTransferUseCase:
      overrides.rejectStockTransferUseCase ??
      new RejectStockTransferUseCase(
        stockTransferRepository,
        auditLogRepository,
        transferNotifier,
        logger,
      ),

    completeStockTransferUseCase:
      overrides.completeStockTransferUseCase ??
      new CompleteStockTransferUseCase(
        stockTransferRepository,
        auditLogRepository,
        transferNotifier,
        logger,
      ),

    // --- Point of sale -----------------------------------------------------
    getMenuUseCase: overrides.getMenuUseCase ?? new GetMenuUseCase(productRepository),

    getPosSummaryUseCase:
      overrides.getPosSummaryUseCase ?? new GetPosSummaryUseCase(posOrderRepository),

    listOrdersUseCase: overrides.listOrdersUseCase ?? new ListOrdersUseCase(posOrderRepository),

    getOrderUseCase: overrides.getOrderUseCase ?? new GetOrderUseCase(posOrderRepository),

    placeOrderUseCase:
      overrides.placeOrderUseCase ??
      new PlaceOrderUseCase(posOrderRepository, productRepository, auditLogRepository, logger),

    receivePaymentUseCase:
      overrides.receivePaymentUseCase ??
      new ReceivePaymentUseCase(posOrderRepository, auditLogRepository, logger),

    cancelOrderUseCase:
      overrides.cancelOrderUseCase ??
      new CancelOrderUseCase(posOrderRepository, auditLogRepository, logger),

    // --- Analytics ---------------------------------------------------------
    getAnalyticsUseCase:
      overrides.getAnalyticsUseCase ?? new GetAnalyticsUseCase(analyticsRepository),

    // --- Daily sales -------------------------------------------------------
    listDailySalesUseCase:
      overrides.listDailySalesUseCase ?? new ListDailySalesUseCase(dailySalesRepository),

    getDailySalesSummaryUseCase:
      overrides.getDailySalesSummaryUseCase ??
      new GetDailySalesSummaryUseCase(dailySalesRepository),

    getDailySalesUseCase:
      overrides.getDailySalesUseCase ?? new GetDailySalesUseCase(dailySalesRepository),

    getDailySalesByDateUseCase:
      overrides.getDailySalesByDateUseCase ??
      new GetDailySalesByDateUseCase(dailySalesRepository),

    recordDailySalesUseCase:
      overrides.recordDailySalesUseCase ??
      new RecordDailySalesUseCase(dailySalesRepository, auditLogRepository, logger),

    updateDailySalesUseCase:
      overrides.updateDailySalesUseCase ??
      new UpdateDailySalesUseCase(dailySalesRepository, auditLogRepository, logger),

    // --- Notifications -----------------------------------------------------
    listNotificationsUseCase:
      overrides.listNotificationsUseCase ?? new ListNotificationsUseCase(notificationRepository),

    getNotificationFeedUseCase:
      overrides.getNotificationFeedUseCase ??
      new GetNotificationFeedUseCase(notificationRepository),

    getUnreadNotificationCountUseCase:
      overrides.getUnreadNotificationCountUseCase ??
      new GetUnreadNotificationCountUseCase(notificationRepository),

    markNotificationReadUseCase:
      overrides.markNotificationReadUseCase ??
      new MarkNotificationReadUseCase(notificationRepository),

    markAllNotificationsReadUseCase:
      overrides.markAllNotificationsReadUseCase ??
      new MarkAllNotificationsReadUseCase(notificationRepository),

    // --- Suppliers ---------------------------------------------------------
    listSuppliersUseCase:
      overrides.listSuppliersUseCase ?? new ListSuppliersUseCase(supplierRepository),

    listSupplierOptionsUseCase:
      overrides.listSupplierOptionsUseCase ?? new ListSupplierOptionsUseCase(supplierRepository),

    getSupplierUseCase: overrides.getSupplierUseCase ?? new GetSupplierUseCase(supplierRepository),

    createSupplierUseCase:
      overrides.createSupplierUseCase ??
      new CreateSupplierUseCase(supplierRepository, auditLogRepository, logger),

    updateSupplierUseCase:
      overrides.updateSupplierUseCase ??
      new UpdateSupplierUseCase(supplierRepository, auditLogRepository, logger),

    deleteSupplierUseCase:
      overrides.deleteSupplierUseCase ??
      new DeleteSupplierUseCase(supplierRepository, auditLogRepository, logger),

    // --- Purchases ---------------------------------------------------------
    listPurchasesUseCase:
      overrides.listPurchasesUseCase ?? new ListPurchasesUseCase(purchaseRepository),

    getPurchaseUseCase: overrides.getPurchaseUseCase ?? new GetPurchaseUseCase(purchaseRepository),

    getPurchaseSummaryUseCase:
      overrides.getPurchaseSummaryUseCase ?? new GetPurchaseSummaryUseCase(purchaseRepository),

    /*
     * The business's own state code is injected rather than read from `env` inside the use
     * case: it is the input that decides CGST/SGST versus IGST, and a test that cannot
     * vary it cannot cover the inter-state path at all.
     */
    recordPurchaseUseCase:
      overrides.recordPurchaseUseCase ??
      new RecordPurchaseUseCase(
        purchaseRepository,
        supplierRepository,
        inventoryItemRepository,
        auditLogRepository,
        env.BUSINESS_STATE_CODE,
        logger,
        purchaseNotifier,
      ),

    uploadPurchaseInvoiceUseCase:
      overrides.uploadPurchaseInvoiceUseCase ??
      new UploadPurchaseInvoiceUseCase(purchaseRepository, fileStorage, auditLogRepository, logger),

    downloadPurchaseInvoiceUseCase:
      overrides.downloadPurchaseInvoiceUseCase ??
      new DownloadPurchaseInvoiceUseCase(purchaseRepository, fileStorage),
  };
}
