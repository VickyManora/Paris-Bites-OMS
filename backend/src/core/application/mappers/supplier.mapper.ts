import type { Supplier } from '../../domain/entities/supplier.entity.js';
import type { SupplierDto, SupplierOptionDto } from '../dtos/supplier.dto.js';

export const SupplierMapper = {
  toDto(supplier: Supplier): SupplierDto {
    const props = supplier.toProps();

    return {
      id: supplier.id,
      name: supplier.name,
      gstin: supplier.gstin,
      stateCode: supplier.stateCode,
      stateName: supplier.stateName,

      contactName: props.contactName,
      email: props.email,
      phone: props.phone,
      addressLine: props.addressLine,
      city: props.city,
      notes: props.notes,

      isActive: supplier.isActive,
      canBePurchasedFrom: supplier.canBePurchasedFrom,
      isGstRegistered: supplier.isGstRegistered,

      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
    };
  },

  toDtoList(suppliers: readonly Supplier[]): SupplierDto[] {
    return suppliers.map((supplier) => SupplierMapper.toDto(supplier));
  },

  toOptionDto(supplier: Supplier): SupplierOptionDto {
    return {
      id: supplier.id,
      name: supplier.name,
      gstin: supplier.gstin,
      stateCode: supplier.stateCode,
      stateName: supplier.stateName,
      isGstRegistered: supplier.isGstRegistered,
    };
  },

  toOptionList(suppliers: readonly Supplier[]): SupplierOptionDto[] {
    return suppliers.map((supplier) => SupplierMapper.toOptionDto(supplier));
  },
} as const;
