-- AlterTable
ALTER TABLE `AiMessages` ADD COLUMN `ClientMessageId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `NotificationPreferences` ADD COLUMN `Push` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `PushDevices` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Platform` VARCHAR(10) NOT NULL,
    `Token` VARCHAR(512) NOT NULL,
    `Name` VARCHAR(120) NULL,
    `AppVersion` VARCHAR(40) NULL,
    `Locale` VARCHAR(10) NULL,
    `LastSeenAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `DisabledAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `PushDevices_Token_key`(`Token`),
    INDEX `PushDevices_UserId_DisabledAt_idx`(`UserId`, `DisabledAt`),
    INDEX `PushDevices_LastSeenAt_idx`(`LastSeenAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushLogs` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `DeviceId` CHAR(36) NULL,
    `NotificationId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Status` VARCHAR(12) NOT NULL,
    `Error` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `PushLogs_UserId_CreatedAt_idx`(`UserId`, `CreatedAt`),
    INDEX `PushLogs_CreatedAt_idx`(`CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `AiMessages_ConversationId_ClientMessageId_key` ON `AiMessages`(`ConversationId`, `ClientMessageId`);

-- AddForeignKey
ALTER TABLE `PushDevices` ADD CONSTRAINT `PushDevices_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushLogs` ADD CONSTRAINT `PushLogs_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushLogs` ADD CONSTRAINT `PushLogs_DeviceId_fkey` FOREIGN KEY (`DeviceId`) REFERENCES `PushDevices`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

