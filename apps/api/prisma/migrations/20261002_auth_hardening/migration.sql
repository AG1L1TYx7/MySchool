-- DropForeignKey
ALTER TABLE `PasswordResetTokens` DROP FOREIGN KEY `PasswordResetTokens_UserId_fkey`;

-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `JoinCode` VARCHAR(16) NULL,
    ADD COLUMN `JoinCodeRotatedAt` DATETIME(6) NULL;

-- AlterTable
ALTER TABLE `Users` ADD COLUMN `LastTotpStep` INTEGER NULL;

-- AlterTable
ALTER TABLE `AuthSessions` ADD COLUMN `AbsoluteExpiresAt` DATETIME(6) NULL;

-- DropTable
DROP TABLE `PasswordResetTokens`;

-- CreateTable
CREATE TABLE `AuthTokens` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Purpose` ENUM('PASSWORD_RESET', 'EMAIL_VERIFY', 'INVITE') NOT NULL,
    `TokenHash` CHAR(64) NOT NULL,
    `ExpiresAt` DATETIME(6) NOT NULL,
    `UsedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `AuthTokens_TokenHash_key`(`TokenHash`),
    INDEX `AuthTokens_UserId_Purpose_idx`(`UserId`, `Purpose`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Organizations_JoinCode_key` ON `Organizations`(`JoinCode`);

-- AddForeignKey
ALTER TABLE `AuthTokens` ADD CONSTRAINT `AuthTokens_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

