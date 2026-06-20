import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Translates raw TypeORM / driver errors into human-friendly HTTP exceptions —
 * the TypeScript counterpart of the original `DatabaseErrorParser`. Supports
 * PostgreSQL (SQLSTATE) and MySQL/MariaDB (errno) codes.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export interface ParsedDbError {
  type: string;
  message: string;
  status: number;
  column?: string;
  constraint?: string;
  detail?: string;
}

export class DatabaseErrorParser {
  static parse(error: unknown): ParsedDbError {
    const driverErr = (error as { driverError?: Record<string, unknown> })?.driverError ?? error;
    const code = String((driverErr as { code?: string })?.code ?? '');
    const message = String((driverErr as { message?: string })?.message ?? (error as Error)?.message ?? '');
    const detail = (driverErr as { detail?: string })?.detail;

    // --- PostgreSQL SQLSTATE codes ---------------------------------------
    switch (code) {
      case '23505': // unique_violation
        return {
          type: 'unique_violation',
          status: 409,
          message: this.uniqueMessage(detail) ?? 'A record with these values already exists.',
          detail,
          constraint: (driverErr as { constraint?: string })?.constraint,
        };
      case '23503': // foreign_key_violation
        return {
          type: 'foreign_key_violation',
          status: 409,
          message:
            'This operation references a related record that does not exist, ' +
            'or the record is still referenced by others.',
          detail,
          constraint: (driverErr as { constraint?: string })?.constraint,
        };
      case '23502': // not_null_violation
        return {
          type: 'not_null_violation',
          status: 422,
          column: (driverErr as { column?: string })?.column,
          message: `The field '${(driverErr as { column?: string })?.column ?? 'unknown'}' is required and cannot be null.`,
        };
      case '23514': // check_violation
        return { type: 'check_violation', status: 422, message: 'A value failed a database check constraint.', detail };
      case '22001': // string_data_right_truncation
        return { type: 'value_too_long', status: 422, message: 'A value is too long for its column.' };
      case '22003': // numeric_value_out_of_range
        return { type: 'out_of_range', status: 422, message: 'A numeric value is out of the allowed range.' };
      case '22P02': // invalid_text_representation
        return { type: 'invalid_input', status: 400, message: 'A value has an invalid format for its column type.' };
      case '42703': // undefined_column
        return { type: 'undefined_column', status: 400, message: this.firstMatch(message, /column\s+"?([^"\s]+)"?\s+does not exist/i, 'Unknown column referenced in the query.') };
      case '42P01': // undefined_table
        return { type: 'undefined_table', status: 400, message: 'Referenced table does not exist.' };
    }

    // --- MySQL / MariaDB errno -------------------------------------------
    const errno = Number((driverErr as { errno?: number })?.errno ?? NaN);
    switch (errno) {
      case 1062: // ER_DUP_ENTRY
        return { type: 'unique_violation', status: 409, message: this.mysqlDuplicate(message) ?? 'A record with these values already exists.' };
      case 1451: // ER_ROW_IS_REFERENCED
      case 1452: // ER_NO_REFERENCED_ROW
        return { type: 'foreign_key_violation', status: 409, message: 'This operation violates a foreign key constraint.' };
      case 1048: // ER_BAD_NULL_ERROR
        return { type: 'not_null_violation', status: 422, message: this.firstMatch(message, /Column\s+'([^']+)'\s+cannot be null/i, 'A required field cannot be null.') };
      case 1406: // ER_DATA_TOO_LONG
        return { type: 'value_too_long', status: 422, message: this.firstMatch(message, /column\s+'([^']+)'/i, 'A value is too long for its column.') };
      case 1264: // ER_WARN_DATA_OUT_OF_RANGE
        return { type: 'out_of_range', status: 422, message: 'A numeric value is out of the allowed range.' };
      case 1054: // ER_BAD_FIELD_ERROR
        return { type: 'undefined_column', status: 400, message: this.firstMatch(message, /Unknown column\s+'([^']+)'/i, 'Unknown column referenced in the query.') };
    }

    return {
      type: 'database_error',
      status: 500,
      message: 'An unexpected database error occurred.',
      detail: message,
    };
  }

  /** Build the HttpException to throw. */
  static toException(parsed: ParsedDbError): HttpException {
    const body = { success: false, error: parsed.type, message: parsed.message, detail: parsed.detail };
    switch (parsed.status) {
      case 400:
        return new BadRequestException(body);
      case 409:
        return new ConflictException(body);
      case 422:
        return new UnprocessableEntityException(body);
      default:
        return new InternalServerErrorException(body);
    }
  }

  static handle(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    return this.toException(this.parse(error));
  }

  private static uniqueMessage(detail?: string): string | null {
    if (!detail) return null;
    const m = detail.match(/Key\s+\(([^)]+)\)=\(([^)]+)\)\s+already exists/i);
    return m ? `A record with ${m[1]} = '${m[2]}' already exists.` : null;
  }

  private static mysqlDuplicate(message: string): string | null {
    const m = message.match(/Duplicate entry\s+'([^']+)'\s+for key\s+'([^']+)'/i);
    return m ? `Duplicate value '${m[1]}' for unique key '${m[2]}'.` : null;
  }

  private static firstMatch(message: string, re: RegExp, fallback: string): string {
    const m = message.match(re);
    return m ? `Unknown or invalid column '${m[1]}'.` : fallback;
  }
}
