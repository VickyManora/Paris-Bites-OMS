/**
 * The store's UPI payment details.
 *
 * Kept in one place because two components need them: the payment sheet displays the QR, and
 * the order page preloads it so the sheet never waits on the network. A second copy of the
 * path is a second thing to forget when the bank card is reissued.
 */

/** Static asset under `public/`. Lower-case extension — Linux will not forgive `.JPG`. */
export const UPI_QR_SRC = '/upi-qr.jpg';

/**
 * Printed beneath the QR as real text.
 *
 * The bank's card has this baked into the image in a small serif face that turns to mush at
 * card size. Rendering it as text keeps it legible and lets a customer whose camera refuses
 * to focus type it in instead.
 */
export const UPI_ID = 'parisbites2@idfcbank';
