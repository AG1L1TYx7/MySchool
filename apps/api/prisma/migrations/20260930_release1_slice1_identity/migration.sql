-- CreateTable
CREATE TABLE `Organizations` (
    `Id` CHAR(36) NOT NULL,
    `Name` VARCHAR(200) NOT NULL,
    `Description` VARCHAR(500) NULL,
    `Email` VARCHAR(100) NULL,
    `Phone` VARCHAR(20) NULL,
    `Address` VARCHAR(500) NULL,
    `Timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Organizations_Name_idx`(`Name`),
    INDEX `Organizations_IsActive_DeletedAt_idx`(`IsActive`, `DeletedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Users` (
    `Id` CHAR(36) NOT NULL,
    `Email` VARCHAR(256) NOT NULL,
    `EmailVerifiedAt` DATETIME(6) NULL,
    `PasswordHash` VARCHAR(512) NOT NULL,
    `PasswordChangedAt` DATETIME(6) NULL,
    `FirstName` VARCHAR(100) NOT NULL,
    `LastName` VARCHAR(100) NOT NULL,
    `Role` ENUM('SUPER_ADMIN', 'SUPERINTENDENT', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'ASSISTANT') NOT NULL,
    `Status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `OrganizationId` CHAR(36) NULL,
    `Phone` VARCHAR(32) NULL,
    `Locale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `Timezone` VARCHAR(64) NULL,
    `AvatarFileId` CHAR(36) NULL,
    `TwoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `TwoFactorSecret` VARCHAR(512) NULL,
    `BackupCodes` TEXT NULL,
    `FailedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `LockedUntil` DATETIME(6) NULL,
    `LastLoginAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    UNIQUE INDEX `Users_Email_key`(`Email`),
    INDEX `Users_OrganizationId_Role_idx`(`OrganizationId`, `Role`),
    INDEX `Users_Status_DeletedAt_idx`(`Status`, `DeletedAt`),
    INDEX `Users_LastName_FirstName_idx`(`LastName`, `FirstName`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSessions` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `FamilyId` CHAR(36) NOT NULL,
    `RefreshTokenHash` CHAR(64) NOT NULL,
    `UserAgent` VARCHAR(500) NULL,
    `IpAddress` VARCHAR(45) NULL,
    `RememberMe` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `LastUsedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `ExpiresAt` DATETIME(6) NOT NULL,
    `RevokedAt` DATETIME(6) NULL,
    `ReplacedById` CHAR(36) NULL,

    UNIQUE INDEX `AuthSessions_RefreshTokenHash_key`(`RefreshTokenHash`),
    INDEX `AuthSessions_UserId_RevokedAt_idx`(`UserId`, `RevokedAt`),
    INDEX `AuthSessions_FamilyId_idx`(`FamilyId`),
    INDEX `AuthSessions_ExpiresAt_idx`(`ExpiresAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetTokens` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `TokenHash` CHAR(64) NOT NULL,
    `ExpiresAt` DATETIME(6) NOT NULL,
    `UsedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `PasswordResetTokens_TokenHash_key`(`TokenHash`),
    INDEX `PasswordResetTokens_UserId_idx`(`UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Features` (
    `Id` CHAR(36) NOT NULL,
    `Code` VARCHAR(100) NOT NULL,
    `Name` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Category` VARCHAR(100) NOT NULL,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Features_Code_key`(`Code`),
    INDEX `Features_Category_idx`(`Category`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoleFeatures` (
    `Id` CHAR(36) NOT NULL,
    `Role` ENUM('SUPER_ADMIN', 'SUPERINTENDENT', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'ASSISTANT') NOT NULL,
    `FeatureId` CHAR(36) NOT NULL,
    `AssignedBy` CHAR(36) NULL,
    `AssignedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `RoleFeatures_FeatureId_idx`(`FeatureId`),
    UNIQUE INDEX `RoleFeatures_Role_FeatureId_key`(`Role`, `FeatureId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserFeatureOverrides` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `FeatureId` CHAR(36) NOT NULL,
    `IsGranted` BOOLEAN NOT NULL,
    `Reason` TEXT NULL,
    `AssignedBy` CHAR(36) NULL,
    `ExpiresAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `UserFeatureOverrides_FeatureId_idx`(`FeatureId`),
    UNIQUE INDEX `UserFeatureOverrides_UserId_FeatureId_key`(`UserId`, `FeatureId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeatureFlags` (
    `Id` CHAR(36) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `IsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `Description` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `FeatureFlags_Name_key`(`Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLogs` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NULL,
    `OrganizationId` CHAR(36) NULL,
    `Action` VARCHAR(100) NOT NULL,
    `EntityType` VARCHAR(100) NULL,
    `EntityId` VARCHAR(100) NULL,
    `IpAddress` VARCHAR(45) NULL,
    `UserAgent` VARCHAR(500) NULL,
    `RequestPath` VARCHAR(500) NULL,
    `HttpMethod` VARCHAR(10) NULL,
    `StatusCode` INTEGER NULL,
    `Details` TEXT NULL,
    `TraceId` VARCHAR(64) NULL,
    `Timestamp` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `AuditLogs_UserId_Timestamp_idx`(`UserId`, `Timestamp`),
    INDEX `AuditLogs_OrganizationId_Timestamp_idx`(`OrganizationId`, `Timestamp`),
    INDEX `AuditLogs_Action_Timestamp_idx`(`Action`, `Timestamp`),
    INDEX `AuditLogs_EntityType_EntityId_idx`(`EntityType`, `EntityId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobRuns` (
    `JobName` VARCHAR(100) NOT NULL,
    `LockedAt` DATETIME(6) NULL,
    `LockedBy` VARCHAR(100) NULL,
    `LastRunAt` DATETIME(6) NULL,
    `LastStatus` VARCHAR(20) NULL,
    `LastError` TEXT NULL,
    `RunCount` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`JobName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Users` ADD CONSTRAINT `Users_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthSessions` ADD CONSTRAINT `AuthSessions_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetTokens` ADD CONSTRAINT `PasswordResetTokens_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleFeatures` ADD CONSTRAINT `RoleFeatures_FeatureId_fkey` FOREIGN KEY (`FeatureId`) REFERENCES `Features`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserFeatureOverrides` ADD CONSTRAINT `UserFeatureOverrides_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserFeatureOverrides` ADD CONSTRAINT `UserFeatureOverrides_FeatureId_fkey` FOREIGN KEY (`FeatureId`) REFERENCES `Features`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLogs` ADD CONSTRAINT `AuditLogs_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

