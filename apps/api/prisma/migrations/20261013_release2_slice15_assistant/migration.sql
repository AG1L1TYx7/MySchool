-- CreateTable
CREATE TABLE `LessonPlans` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NULL,
    `CourseId` CHAR(36) NULL,
    `LessonId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Topic` VARCHAR(200) NOT NULL,
    `DurationMinutes` INTEGER NOT NULL DEFAULT 45,
    `GradeLevel` VARCHAR(16) NULL,
    `Subject` VARCHAR(100) NULL,
    `StandardCodes` TEXT NULL,
    `Content` TEXT NOT NULL,
    `Status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `ScheduledOn` DATE NULL,
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `LessonPlans_OrganizationId_AuthorId_UpdatedAt_idx`(`OrganizationId`, `AuthorId`, `UpdatedAt`),
    INDEX `LessonPlans_ClassId_ScheduledOn_idx`(`ClassId`, `ScheduledOn`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GradingSuggestions` (
    `Id` CHAR(36) NOT NULL,
    `SubmissionId` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `RequestedById` CHAR(36) NOT NULL,
    `Content` TEXT NOT NULL,
    `Score` DECIMAL(7, 2) NOT NULL,
    `MaxPoints` DECIMAL(7, 2) NOT NULL,
    `Confidence` DECIMAL(3, 2) NOT NULL,
    `NeedsHumanReview` BOOLEAN NOT NULL DEFAULT true,
    `Flag` TEXT NULL,
    `Status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `ReviewedById` CHAR(36) NULL,
    `ReviewedAt` DATETIME(6) NULL,
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `GradingSuggestions_SubmissionId_key`(`SubmissionId`),
    INDEX `GradingSuggestions_AssignmentId_Status_idx`(`AssignmentId`, `Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeacherDrafts` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NOT NULL,
    `Kind` VARCHAR(30) NOT NULL,
    `StudentId` CHAR(36) NULL,
    `LessonId` CHAR(36) NULL,
    `ClassId` CHAR(36) NULL,
    `Language` VARCHAR(16) NOT NULL DEFAULT 'en',
    `Title` VARCHAR(200) NOT NULL,
    `Content` TEXT NOT NULL,
    `Status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `TeacherDrafts_AuthorId_Kind_CreatedAt_idx`(`AuthorId`, `Kind`, `CreatedAt`),
    INDEX `TeacherDrafts_StudentId_idx`(`StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassInsights` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `WeekStart` DATE NOT NULL,
    `RequestedById` CHAR(36) NOT NULL,
    `Data` TEXT NOT NULL,
    `Narrative` TEXT NULL,
    `PracticeContentId` CHAR(36) NULL,
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `ClassInsights_ClassId_WeekStart_key`(`ClassId`, `WeekStart`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubstituteAccess` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NOT NULL,
    `StartsAt` DATETIME(6) NOT NULL,
    `EndsAt` DATETIME(6) NOT NULL,
    `Note` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `SubstituteAccess_ClassId_EndsAt_idx`(`ClassId`, `EndsAt`),
    INDEX `SubstituteAccess_UserId_EndsAt_idx`(`UserId`, `EndsAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LessonPlans` ADD CONSTRAINT `LessonPlans_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonPlans` ADD CONSTRAINT `LessonPlans_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonPlans` ADD CONSTRAINT `LessonPlans_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonPlans` ADD CONSTRAINT `LessonPlans_CourseId_fkey` FOREIGN KEY (`CourseId`) REFERENCES `Courses`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonPlans` ADD CONSTRAINT `LessonPlans_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `Lessons`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingSuggestions` ADD CONSTRAINT `GradingSuggestions_SubmissionId_fkey` FOREIGN KEY (`SubmissionId`) REFERENCES `AssignmentSubmissions`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingSuggestions` ADD CONSTRAINT `GradingSuggestions_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingSuggestions` ADD CONSTRAINT `GradingSuggestions_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingSuggestions` ADD CONSTRAINT `GradingSuggestions_RequestedById_fkey` FOREIGN KEY (`RequestedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingSuggestions` ADD CONSTRAINT `GradingSuggestions_ReviewedById_fkey` FOREIGN KEY (`ReviewedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherDrafts` ADD CONSTRAINT `TeacherDrafts_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherDrafts` ADD CONSTRAINT `TeacherDrafts_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherDrafts` ADD CONSTRAINT `TeacherDrafts_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherDrafts` ADD CONSTRAINT `TeacherDrafts_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `Lessons`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassInsights` ADD CONSTRAINT `ClassInsights_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassInsights` ADD CONSTRAINT `ClassInsights_RequestedById_fkey` FOREIGN KEY (`RequestedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubstituteAccess` ADD CONSTRAINT `SubstituteAccess_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubstituteAccess` ADD CONSTRAINT `SubstituteAccess_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubstituteAccess` ADD CONSTRAINT `SubstituteAccess_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

