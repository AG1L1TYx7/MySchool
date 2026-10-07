-- Tenancy (ADR-005, expand-migrate-contract in one deploy): create Tenants, give every existing
-- organisation the default tenant, then make the column required.

-- CreateTable
CREATE TABLE `Tenants` (
    `Id` CHAR(36) NOT NULL,
    `Name` VARCHAR(200) NOT NULL,
    `Slug` VARCHAR(63) NOT NULL,
    `Status` VARCHAR(12) NOT NULL DEFAULT 'active',
    `CustomDomain` VARCHAR(253) NULL,
    `DomainToken` VARCHAR(64) NULL,
    `DomainVerifiedAt` DATETIME(6) NULL,
    `Branding` TEXT NULL,
    `Policies` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Tenants_Slug_key`(`Slug`),
    UNIQUE INDEX `Tenants_CustomDomain_key`(`CustomDomain`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Expand
ALTER TABLE `Organizations` ADD COLUMN `TenantId` CHAR(36) NULL;

-- Migrate: one default tenant for everything that exists today.
INSERT INTO `Tenants` (`Id`, `Name`, `Slug`, `Status`, `CreatedAt`, `UpdatedAt`)
VALUES ('00000000-0000-7000-8000-000000000001', 'Default district', 'default', 'active', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));
UPDATE `Organizations` SET `TenantId` = '00000000-0000-7000-8000-000000000001' WHERE `TenantId` IS NULL;

-- Contract
ALTER TABLE `Organizations` MODIFY `TenantId` CHAR(36) NOT NULL;
CREATE INDEX `Organizations_TenantId_idx` ON `Organizations`(`TenantId`);
ALTER TABLE `Organizations` ADD CONSTRAINT `Organizations_TenantId_fkey` FOREIGN KEY (`TenantId`) REFERENCES `Tenants`(`Id`) ON DELETE RESTRICT ON UPDATE CASCADE;
