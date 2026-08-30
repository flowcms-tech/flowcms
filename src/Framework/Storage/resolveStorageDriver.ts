import { S3StorageDriver } from "./drivers/S3StorageDriver"
import type { StorageDriver } from "./StorageDriver"

/**
 * Which backend serves this request.
 *
 * ONE DRIVER EXISTS TODAY, and this function returns it unconditionally. It is
 * still worth having, because it is the single place a second driver will be
 * selected from — and because putting the choice here now means `StorageService`
 * is already written against "whatever driver is active" rather than against
 * S3, which is the entire point of the seam.
 *
 * ASYNC ON PURPOSE, DESPITE AWAITING NOTHING YET. Choosing a driver will mean
 * reading configuration (the settings row over environment variables, exactly
 * as `getS3Config()` already does), and that read is asynchronous. Declaring
 * the signature now keeps the change that introduces a second driver confined
 * to this file, instead of rippling `await` through every method of
 * `StorageService` at the moment the system is least able to absorb churn.
 *
 * RESOLVED PER CALL, NEVER CACHED IN A MODULE VARIABLE. The same rule the S3
 * connection follows, for the same reason: an operator who changes storage
 * configuration must be served by the next request, not the next restart. A
 * cached driver would also outlive a configuration switch, which is precisely
 * the failure the later switching work has to avoid.
 */
export async function resolveStorageDriver(): Promise<StorageDriver> {
  return S3StorageDriver
}
