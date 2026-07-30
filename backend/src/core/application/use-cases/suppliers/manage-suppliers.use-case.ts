import { isGstStateCode } from '../../../domain/enums/purchase.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';
import type {
  CreateSupplierInput,
  DeleteSupplierInput,
  SupplierDto,
  UpdateSupplierInput,
} from '../../dtos/supplier.dto.js';
import { SupplierMapper } from '../../mappers/supplier.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { SupplierAuditAction } from './supplier-audit.js';

/**
 * A GSTIN's 1st–2nd characters are the state code, and it must agree with the state
 * recorded against the supplier.
 *
 * Checked because the two are entered separately and a mismatch is silent but expensive:
 * the state drives the CGST/SGST-versus-IGST decision, so a Maharashtra GSTIN filed under
 * Karnataka produces the wrong split on every invoice from that vendor.
 */
function assertGstinMatchesState(gstin: string | undefined, stateCode: string): void {
  if (gstin === undefined || gstin.length === 0) {
    return;
  }

  if (gstin.slice(0, 2) !== stateCode) {
    throw new BusinessRuleError(
      `This GSTIN belongs to state ${gstin.slice(0, 2)}, but the supplier is recorded in state ${stateCode}.`,
      { gstin: ['The GSTIN does not match the selected state.'] },
    );
  }
}

function assertValidStateCode(stateCode: string): void {
  if (!isGstStateCode(stateCode)) {
    throw new BusinessRuleError(`"${stateCode}" is not a GST state code.`, {
      stateCode: ['Select a valid state.'],
    });
  }
}

export class CreateSupplierUseCase implements IUseCase<CreateSupplierInput, SupplierDto> {
  constructor(
    private readonly suppliers: ISupplierRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CreateSupplierInput): Promise<SupplierDto> {
    const gstin = input.gstin?.trim().toUpperCase();

    assertValidStateCode(input.stateCode);
    assertGstinMatchesState(gstin, input.stateCode);

    const supplier = await this.suppliers.create({
      name: input.name.trim(),
      gstin,
      stateCode: input.stateCode,
      contactName: input.contactName?.trim(),
      email: input.email?.trim().toLowerCase(),
      phone: input.phone?.trim(),
      addressLine: input.addressLine?.trim(),
      city: input.city?.trim(),
      notes: input.notes?.trim(),
      createdById: input.actorId,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: SupplierAuditAction.CREATED,
      entityType: 'Supplier',
      entityId: supplier.id,
      ip: input.ipAddress,
      metadata: { name: supplier.name, gstin: supplier.gstin, stateCode: supplier.stateCode },
    });

    this.logger.info('Supplier created', { supplierId: supplier.id, name: supplier.name });

    return SupplierMapper.toDto(supplier);
  }
}

export class UpdateSupplierUseCase implements IUseCase<UpdateSupplierInput, SupplierDto> {
  constructor(
    private readonly suppliers: ISupplierRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: UpdateSupplierInput): Promise<SupplierDto> {
    const existing = await this.suppliers.findById(input.id);

    if (existing === null || existing.isDeleted) {
      throw new NotFoundError('Supplier', input.id);
    }

    // The pair is validated against the *resulting* state, not the submitted one: changing
    // only the GSTIN must still be checked against the state already on record.
    const stateCode = input.stateCode ?? existing.stateCode;
    const gstin =
      input.gstin === undefined
        ? (existing.gstin ?? undefined)
        : (input.gstin?.trim().toUpperCase() ?? undefined);

    assertValidStateCode(stateCode);
    assertGstinMatchesState(gstin, stateCode);

    const supplier = await this.suppliers.update(input.id, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.gstin !== undefined && { gstin }),
      ...(input.stateCode !== undefined && { stateCode: input.stateCode }),
      ...(input.contactName !== undefined && { contactName: input.contactName.trim() }),
      ...(input.email !== undefined && { email: input.email.trim().toLowerCase() }),
      ...(input.phone !== undefined && { phone: input.phone.trim() }),
      ...(input.addressLine !== undefined && { addressLine: input.addressLine.trim() }),
      ...(input.city !== undefined && { city: input.city.trim() }),
      ...(input.notes !== undefined && { notes: input.notes.trim() }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: SupplierAuditAction.UPDATED,
      entityType: 'Supplier',
      entityId: supplier.id,
      ip: input.ipAddress,
      metadata: { name: supplier.name },
    });

    this.logger.info('Supplier updated', { supplierId: supplier.id });

    return SupplierMapper.toDto(supplier);
  }
}

/**
 * Soft-deletes a supplier.
 *
 * A supplier with purchase history is **deactivated instead**, not refused. Refusing would
 * leave no way to retire a vendor you have ever bought from, which is every vendor that
 * matters; hard-deleting would orphan the invoices. Deactivation removes it from the
 * purchase dropdown while every historical invoice still resolves and still prints the
 * name — which is what "remove this supplier" actually means to the person asking.
 */
export class DeleteSupplierUseCase implements IUseCase<DeleteSupplierInput, SupplierDto | null> {
  constructor(
    private readonly suppliers: ISupplierRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: DeleteSupplierInput): Promise<SupplierDto | null> {
    const existing = await this.suppliers.findById(input.id);

    if (existing === null || existing.isDeleted) {
      throw new NotFoundError('Supplier', input.id);
    }

    if (await this.suppliers.hasPurchases(input.id)) {
      const deactivated = await this.suppliers.update(input.id, { isActive: false });

      await this.auditLog.record({
        actorId: input.actorId,
        action: SupplierAuditAction.DEACTIVATED,
        entityType: 'Supplier',
        entityId: input.id,
        ip: input.ipAddress,
        metadata: { name: existing.name, reason: 'has purchase history' },
      });

      this.logger.info('Supplier deactivated rather than deleted', {
        supplierId: input.id,
        reason: 'has purchase history',
      });

      return SupplierMapper.toDto(deactivated);
    }

    await this.suppliers.softDelete(input.id);

    await this.auditLog.record({
      actorId: input.actorId,
      action: SupplierAuditAction.DELETED,
      entityType: 'Supplier',
      entityId: input.id,
      ip: input.ipAddress,
      metadata: { name: existing.name },
    });

    this.logger.info('Supplier deleted', { supplierId: input.id });

    // Null tells the controller to answer 204: there is no longer a resource to return.
    return null;
  }
}
