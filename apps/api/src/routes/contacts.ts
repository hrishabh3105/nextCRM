import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { ApiError, forWorkspace, validateOrThrow } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createContactSchema,
  updateContactSchema,
  CreateContactInput,
  UpdateContactInput,
} from "../validation/contactSchema";

export const contactsRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /
 * Lists contacts for the authenticated workspace.
 * Supports optional ?search= query param matching name or phone (case-insensitive).
 */
contactsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const contacts = await forWorkspace(req.workspaceId!).contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.status(200).json(contacts);
  })
);

/**
 * GET /:id
 * Retrieves a single contact by id within the authenticated workspace.
 */
contactsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const contact = await forWorkspace(req.workspaceId!).contact.findUnique({
      where: { id: req.params.id },
    });

    if (!contact) {
      throw new ApiError(404, "Contact not found");
    }

    res.status(200).json(contact);
  })
);

/**
 * POST /
 * Creates a new contact within the authenticated workspace.
 */
contactsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateContactInput>(
      createContactSchema,
      req.body
    );

    const contact = await forWorkspace(req.workspaceId!).contact.create({
      data: validatedData as any,
    });

    res.status(201).json(contact);
  })
);

/**
 * PATCH /:id
 * Updates an existing contact within the authenticated workspace.
 */
contactsRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<UpdateContactInput>(
      updateContactSchema,
      req.body
    );

    const contact = await forWorkspace(req.workspaceId!).contact.update({
      where: { id: req.params.id },
      data: validatedData,
    });

    res.status(200).json(contact);
  })
);

/**
 * POST /import
 * Bulk imports contacts from a CSV file using upsert.
 */
contactsRouter.post(
  "/import",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ApiError(400, "file is required");
    }

    const content = req.file.buffer.toString("utf-8");
    const records: any[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let imported = 0;
    const skipped: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 1;

      try {
        const rowInput = {
          phone: row.phone,
          name: row.name ? row.name.trim() : undefined,
          email: row.email ? row.email.trim() : undefined,
        };

        const validatedData = validateOrThrow<CreateContactInput>(
          createContactSchema,
          rowInput
        );
        const { phone: validatedPhone, ...updateData } = validatedData;

        await forWorkspace(req.workspaceId!).contact.upsert({
          where: {
            workspaceId_phone: {
              workspaceId: req.workspaceId!,
              phone: validatedPhone,
            },
          },
          create: validatedData as any,
          update: updateData,
        });

        imported++;
      } catch (err: any) {
        let reason = "Validation failed";
        if (err instanceof ApiError) {
          if (err.details?.fieldErrors) {
            const fieldMsgs = Object.entries(err.details.fieldErrors)
              .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
              .join("; ");
            reason = fieldMsgs || err.message;
          } else {
            reason = err.message;
          }
        } else if (err.message) {
          reason = err.message;
        }

        skipped.push({ row: rowNumber, reason });
      }
    }

    res.status(200).json({
      totalRows: records.length,
      imported,
      skipped,
    });
  })
);
