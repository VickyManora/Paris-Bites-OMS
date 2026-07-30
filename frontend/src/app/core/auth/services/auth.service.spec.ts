import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Permission } from '../../models/permission.model';
import { Role } from '../../models/role.model';
import { AuthService } from './auth.service';

/**
 * These decide what the UI offers.
 *
 * They do **not** decide what the user can do — the API authorises every request
 * independently, because the bundle ships to the browser. What they must get right is the
 * safe direction of failure: an unknown or signed-out user is granted nothing, and `canAll`
 * over an empty list does not accidentally mean "yes".
 */
describe('AuthService permission checks', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AuthService);
  });

  /**
   * Sets the signed-in user the way a login response would.
   *
   * Reaching for the private signal rather than driving a real login: the permission logic
   * is what is under test here, and routing an HTTP round trip through it would test the
   * interceptor stack instead.
   */
  function signIn(permissions: readonly Permission[], role: Role = Role.STORE_MANAGER): void {
    const state = service as unknown as {
      currentUser: { set: (value: unknown) => void };
    };

    state.currentUser.set({
      id: 'user-1',
      email: 'manager@parisbites.local',
      firstName: 'Store',
      lastName: 'Manager',
      fullName: 'Store Manager',
      role,
      status: 'ACTIVE',
      permissions,
    });
  }

  describe('when nobody is signed in', () => {
    it('grants nothing', () => {
      expect(service.can(Permission.PRODUCT_READ)).toBe(false);
      expect(service.canAny([Permission.PRODUCT_READ, Permission.SALE_READ])).toBe(false);
    });

    /**
     * `every` over an empty array is `true` in JavaScript, so an accidental empty
     * requirement list would render an admin-only control for a signed-out visitor. The
     * directive guards this with an `isAuthenticated()` check; this pins the shape of the
     * hazard so nobody removes it.
     */
    it('reports canAll([]) as vacuously true, which is why the directive also checks auth', () => {
      expect(service.canAll([])).toBe(true);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('exposes no permissions', () => {
      expect(service.permissions()).toEqual([]);
    });
  });

  describe('when a Store Manager is signed in', () => {
    beforeEach(() => {
      signIn([Permission.PRODUCT_READ, Permission.STOCK_READ, Permission.STOCK_ADJUST]);
    });

    it('grants what they hold', () => {
      expect(service.can(Permission.STOCK_ADJUST)).toBe(true);
    });

    it('withholds what they do not', () => {
      // Both are admin-only in this app.
      expect(service.can(Permission.SALE_READ)).toBe(false);
      expect(service.can(Permission.REPORT_VIEW_FINANCIAL)).toBe(false);
    });

    it('canAny needs only one', () => {
      expect(service.canAny([Permission.SALE_READ, Permission.STOCK_READ])).toBe(true);
    });

    it('canAll needs every one', () => {
      expect(service.canAll([Permission.STOCK_READ, Permission.STOCK_ADJUST])).toBe(true);
      expect(service.canAll([Permission.STOCK_READ, Permission.SALE_READ])).toBe(false);
    });

    it('knows their role', () => {
      expect(service.hasRole(Role.STORE_MANAGER)).toBe(true);
      expect(service.hasRole(Role.ADMIN)).toBe(false);
    });
  });

  describe('when an admin is signed in', () => {
    beforeEach(() => {
      signIn(
        [Permission.SALE_READ, Permission.SALE_RECORD, Permission.REPORT_VIEW_FINANCIAL],
        Role.ADMIN,
      );
    });

    it('grants the financial permissions a manager is refused', () => {
      expect(service.can(Permission.SALE_READ)).toBe(true);
      expect(service.can(Permission.REPORT_VIEW_FINANCIAL)).toBe(true);
    });

    /** Permissions come from the server; holding the ADMIN role is not itself a grant. */
    it('does not infer permissions from the role', () => {
      expect(service.can(Permission.PRODUCT_READ)).toBe(false);
    });
  });
});
