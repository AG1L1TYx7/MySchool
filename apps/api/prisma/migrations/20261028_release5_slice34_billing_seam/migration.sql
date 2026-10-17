-- AlterTable
ALTER TABLE `Invoices` ADD COLUMN `ProviderPaymentRef` VARCHAR(120) NULL,
    ADD COLUMN `RefundedAt` DATETIME(6) NULL;

