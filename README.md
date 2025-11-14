# Project Notes / User Roles and Flow

## Default Accounts
- **Admin:**  
  Email: `admin@gmail.com`  
  Password: `123456`

- **User:**  
  Email: `beckham@gmail.com`  
  Password: `123456`

- **Tourist:**  
  Email: `borshon@gmail.com`  
  Password: `123456`

- **Guide:**  
  Email: `john@snow.com`  
  Password: `123456`

---

## User Role Flow

1. **User Login**  
   - When a user logs in for the first time, their role is automatically set to `user` in the database.

2. **Booking a Tour Package**  
   - From a tour package page (`tour_package -> details`), a user fills the `Book This Tour` form.
   - Once the booking is confirmed:
     - A new Nav link `My Bookings` appears.
     - Clicking `Pay` button redirects to Stripe payment.
     - After successful payment, the user's role changes to `tourist`.
     - The Nav link `My Bookings` converts into `Dashboard`.

3. **Become a Guide**  
   - Users can fill a `Become a Guide` form.
   - Admin reviews requests in `Manage Candidate` page.
   - Upon approval, the user's role changes to `guide`.

4. **Package Booking Restrictions**  
   - **Guide** and **Admin** **cannot** book any packages.  
   - **User** and **Tourist** **can** book packages.

---

> >==>> **Note:** Roles dynamically change based on user actions:
> - `user` → `tourist` after successful tour booking & payment.  
> - `user` → `guide` after admin approval via Manage Candidate.  
> - Admin & Guide have restricted access for package booking.

