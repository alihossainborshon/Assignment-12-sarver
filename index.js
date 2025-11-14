require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8000;

// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://assignment-12-d2d87.web.app",
      "https://assignment-12-d2d87.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// verify jwt token
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "Unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// Database connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d2ibw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // mongo collections
    const usersCollection = client.db("Tourism-DB").collection("users");
    const packagesCollection = client.db("Tourism-DB").collection("packages");
    const bookingsCollection = client.db("Tourism-DB").collection("bookings");
    const storiesCollection = client.db("Tourism-DB").collection("stories");

    // verify Admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden access! Admin only Action." });
      }
      next();
    };

    // verify Guide middleware
    const verifyGuide = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "guide") {
        return res.status(403).send({
          error: true,
          message: "Forbidden access! Seller only Action.",
        });
      }
      next();
    };

    // verify Tourist middleware
    const verifyTourist = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "tourist") {
        return res.status(403).send({
          error: true,
          message: "Forbidden access! Tourist only Action.",
        });
      }
      next();
    };

    // verify Tourist or Guide middleware
    const verifyTouristOrGuide = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (!user || (user.role !== "tourist" && user.role !== "guide")) {
        return res.status(403).send({
          error: true,
          message: "Forbidden! Only Tourist or Guide can access.",
        });
      }
      next();
    };

    // =============================================
    // JWT Login Token
    // =============================================
    // JWT Token
    app.post("/jwt", async (req, res) => {
      const token = jwt.sign(req.body, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10h",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
        .send({ success: true });
    });

    // Log out
    app.get("/logOut", async (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
        .send({ success: true });
    });

    // =============================================
    // USERS API
    // =============================================

    // Users create & read
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Get user role by email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // Guide application
    app.patch("/users/:email", verifyToken, verifyTourist, async (req, res) => {
      try {
        const email = req.params.email;
        const { title, reason, cvLink } = req.body;
        const query = { email };
        const user = await usersCollection.findOne(query);
        if (!user) {
          return res.status(404).send("User not found.");
        }
        if (user.status === "Requested") {
          return res
            .status(400)
            .send("You have already requested, wait for some time.");
        }
        const updateDoc = {
          $set: {
            status: "Requested",
            guideApplication: {
              title,
              reason,
              cvLink,
              requestedAt: new Date(),
            },
          },
        };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send({ message: "Application submitted successfully", result });
      } catch (error) {
        res.status(500).send("Internal Server Error", error);
      }
    });

    // Update user profile (name, photo) and cascade to bookings & stories
    app.patch("/users/profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { name, photo } = req.body;

      const query = { email };

      const exists = await usersCollection.findOne(query);
      if (!exists) {
        return res.status(404).send({
          success: false,
          message: "User not found",
        });
      }

      // User update document
      const updatedData = { $set: { name, photo } };

      const updateUser = await usersCollection.updateOne(query, updatedData);

      const updateTouristBookings = await bookingsCollection.updateMany(
        { touristEmail: email },
        { $set: { touristName: name, touristPhoto: photo } }
      );

      const updateGuideBookings = await bookingsCollection.updateMany(
        { guideEmail: email },
        { $set: { guideName: name, guidePhoto: photo } }
      );

      const updateStories = await storiesCollection.updateMany(
        { "author.email": email },
        { $set: { "author.name": name, "author.photo": photo } }
      );

      return res.send({
        success: true,
        message: "Profile updated in users, bookings, and stories collections",
        updates: {
          updateUser,
          updateTouristBookings,
          updateGuideBookings,
          updateStories,
        },
      });
    });

    // =============================================
    // PACKAGES API
    // ============================================
    // Packages create & read
    app.post("/packages", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const newPackage = req.body;
        const result = await packagesCollection.insertOne(newPackage);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add package", error });
      }
    });

    // Get all packages
    app.get("/packages", async (req, res) => {
      const result = await packagesCollection.find().toArray();
      res.send(result);
    });

    // =============================================
    // Admin - candidates
    app.get(
      "/manage-candidates",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const query = { status: "Requested" };
          const candidates = await usersCollection.find(query).toArray();
          res.send(candidates);
        } catch (error) {
          res.status(500).send("Failed to fetch candidates.");
        }
      }
    );

    // Approve / Reject candidate
    app.patch(
      "/manage-candidates/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const email = req.params.email;
          const { action } = req.body;
          const query = { email };
          const user = await usersCollection.findOne(query);
          if (!user) return res.status(404).send("User not found.");

          let updateDoc;
          if (action === "approve") {
            updateDoc = {
              $set: {
                role: "guide",
                status: "Approved",
                approvedAt: new Date(),
              },
            };
          } else if (action === "reject") {
            updateDoc = {
              $set: {
                status: "Rejected",
                rejectedAt: new Date(),
              },
            };
          } else {
            return res.status(400).send("Invalid action.");
          }
          const result = await usersCollection.updateOne(query, updateDoc);
          res.send({ message: `User ${action}d successfully.`, result });
        } catch (error) {
          console.error(error);
          res.status(500).send("Failed to update candidate.");
        }
      }
    );

    // Users list & delete
    app.get("/all-users/:email", verifyToken, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to load users" });
      }
    });

    // Delete user
    app.delete("/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        if (result.deletedCount > 0) {
          res.send({ success: true, message: "User deleted successfully" });
        } else {
          res.status(404).send({
            success: false,
            message: "User not found or already deleted",
          });
        }
      } catch (error) {
        console.error("Error deleting user:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to delete user" });
      }
    });

    // Bookings - create
    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const booking = req.body;

        if (!booking || !booking.touristEmail) {
          return res.status(400).send({ message: "Invalid booking data" });
        }

        // Insert booking only
        const result = await bookingsCollection.insertOne(booking);

        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error("Error creating booking:", error);
        res.status(500).send({ message: "Failed to create booking" });
      }
    });

    // Get bookings by user email
    app.get(
      "/bookings/:email",
      verifyToken,

      async (req, res) => {
        const email = req.params.email;
        const result = await bookingsCollection
          .find({ touristEmail: email })
          .toArray();
        res.send(result);
      }
    );

    // Delete booking
    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await bookingsCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        res.send({ success: true, message: "Booking deleted successfully" });
      } else {
        res.status(404).send({ success: false, message: "Booking not found" });
      }
    });

    // Get all packages (for Trips page)
    app.get("/api/packages", async (req, res) => {
      try {
        const packages = await packagesCollection.find({}).toArray();
        res.send(packages);
      } catch (err) {
        console.error("Failed to fetch all packages:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get random packages (for Home Tab)
    app.get("/api/packages/random", async (req, res) => {
      try {
        const count = await packagesCollection.countDocuments();
        if (count === 0) {
          return res.status(404).json({ error: "No packages available" });
        }

        const randomPackages = await packagesCollection
          .aggregate([{ $sample: { size: 3 } }])
          .toArray();

        res.send(randomPackages);
      } catch (err) {
        console.error("Failed to fetch random packages:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get a single package by ID (for PackageDetails page)
    app.get("/api/packages/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid package ID format" });
        }

        const packageData = await packagesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!packageData) {
          return res.status(404).json({ error: "Package not found" });
        }

        res.send(packageData);
      } catch (err) {
        console.error("Error fetching package by ID:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Random guides
    app.get("/api/guides/random", async (req, res) => {
      try {
        if (!usersCollection) {
          return res
            .status(500)
            .json({ error: "Users collection not initialized" });
        }

        const guides = await usersCollection.find({ role: "guide" }).toArray();

        res.send(guides);
      } catch (err) {
        console.error("Failed to fetch random guides:", err);
        res.status(500).send({ error: "Failed to fetch random guides" });
      }
    });

    // payments
    // Create Payment Intent (Stripe)
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      try {
        const { amount } = req.body; // expect number (e.g. 35000)
        if (!amount && amount !== 0)
          return res.status(400).send({ error: "Amount required" });

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Stripe expects smallest currency unit
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("create-payment-intent error:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // Save payment info inside bookings collection
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;

        // 1 Update booking status to "in review" in bookings collection
        const bookingUpdate = await bookingsCollection.updateOne(
          { _id: new ObjectId(payment.bookingId) },
          {
            $set: {
              status: "in review",
              transactionId: payment.transactionId,
              paidAt: new Date(),
            },
          }
        );

        // 2 Update user role if current role is "user"
        if (payment.customerEmail) {
          const user = await usersCollection.findOne({
            email: payment.customerEmail,
          });
          if (user && user.role === "user") {
            await usersCollection.updateOne(
              { email: payment.customerEmail },
              { $set: { role: "tourist" } }
            );
          }
        }

        res.send({
          success: true,
          message: "Payment successful, booking updated.",
          bookingUpdate,
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // Alternative: patch endpoint
    app.patch("/bookings/payment/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const paymentData = req.body;

        //Update booking info
        const updateDoc = {
          $set: {
            status: paymentData.status || "in review",
            transactionId: paymentData.transactionId,
            paidAt: paymentData.paidAt || new Date(),
            paymentInfo: {
              amount: paymentData.amount || null,
              method: paymentData.method || "card",
              customerEmail: paymentData.customerEmail || null,
            },
          },
        };

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "Booking not found" });
        }

        //Update user role if current role is "user"
        if (paymentData.customerEmail) {
          const user = await usersCollection.findOne({
            email: paymentData.customerEmail,
          });
          if (user && user.role === "user") {
            await usersCollection.updateOne(
              { email: paymentData.customerEmail },
              { $set: { role: "tourist" } }
            );
          }
        }

        res.send({ success: true, result });
      } catch (err) {
        console.error("patch /bookings/payment error:", err);
        res.status(500).send({ success: false, message: err.message });
      }
    });

    // Get paid/in-review bookings for a user (My Orders)
    app.get(
      "/my-orders/:email",
      verifyToken,
      verifyTourist,
      async (req, res) => {
        try {
          const email = req.params.email;
          // return bookings where this user paid (status in these states)
          const result = await bookingsCollection
            .find({
              touristEmail: email,
              status: { $in: ["in review", "paid", "accepted"] },
            })
            .toArray();
          res.send(result);
        } catch (err) {
          console.error("my-orders error:", err);
          res.status(500).send({ error: err.message });
        }
      }
    );

    // Get assigned tours for a guide
    app.get(
      "/assigned-tours/:email",
      verifyToken,
      verifyGuide,
      async (req, res) => {
        try {
          const email = req.params.email;
          const result = await bookingsCollection
            .find({ guideEmail: email })
            .toArray();
          res.send(result);
        } catch (err) {
          console.error("assigned-tours error:", err);
          res.status(500).send({ error: err.message });
        }
      }
    );

    // ----------------------
    // Update assigned tour status
    app.patch(
      "/assigned-tours/:id",
      verifyToken,
      verifyGuide,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;

          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );

          res.send({
            success: true,
            message: `Tour status updated to ${status}`,
            result,
          });
        } catch (error) {
          res.status(500).send({ success: false, message: error.message });
        }
      }
    );

    // Delete booking & remove from assigned tours
    app.delete("/bookings/:id", verifyToken, verifyGuide, async (req, res) => {
      try {
        const id = req.params.id;
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking)
          return res
            .status(404)
            .send({ success: false, message: "Booking not found" });

        // Delete booking
        await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

        res.send({ success: true, message: "Booking cancelled successfully" });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ====================
    // Stories API
    // ====================

    // Add new story
    app.post(
      "/stories",
      verifyToken,
      verifyTouristOrGuide,

      async (req, res) => {
        try {
          const { title, text, images } = req.body;
          const userEmail = req.user.email;

          if (!title || !text || !images?.length)
            return res.status(400).send({ error: "All fields required" });

          // Get full user data
          const user = await usersCollection.findOne({ email: userEmail });
          if (!user) return res.status(404).send({ error: "User not found" });

          const newStory = {
            title,
            text,
            images,
            author: {
              _id: user._id,
              name: user.name,
              email: user.email,
              photo: user?.photo || "",
              role: user.role,
            },
            createdAt: new Date(),
          };

          const result = await storiesCollection.insertOne(newStory);

          res.send({
            success: true,
            storyId: result.insertedId,
            author: newStory.author,
          });
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .send({ success: false, message: "Failed to add story" });
        }
      }
    );

    // Get all stories (public, for homepage)
    app.get("/all-stories", async (req, res) => {
      try {
        const stories = await storiesCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(stories);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to load stories" });
      }
    });

    // Get all stories of logged-in user
    app.get("/stories", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const stories = await storiesCollection
          .find({ "author.email": userEmail })
          .toArray();
        res.send(stories);
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Failed to load stories" });
      }
    });

    // Get story by id
    app.get(
      "/stories/:id",
      verifyToken,
      verifyTouristOrGuide,
      async (req, res) => {
        try {
          const id = req.params.id.trim();
          const story = await storiesCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!story)
            return res.status(404).send({ message: "Story not found" });
          res.send(story);
        } catch (err) {
          console.error(err);
          res.status(500).send({ success: false, message: err.message });
        }
      }
    );

    // Update story (title, text)
    app.patch(
      "/stories/:id",
      verifyToken,
      verifyTouristOrGuide,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { title, text } = req.body;
          const updateDoc = { $set: {} };
          if (title) updateDoc.$set.title = title;
          if (text) updateDoc.$set.text = text;

          const result = await storiesCollection.updateOne(
            { _id: new ObjectId(id) },
            updateDoc
          );
          res.send({ success: true, result });
        } catch (err) {
          res.status(500).send({ success: false, message: err.message });
        }
      }
    );

    // Add new images to story
    app.patch(
      "/stories/:id/images",
      verifyToken,
      verifyTouristOrGuide,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { images } = req.body; // array of urls
          if (!images?.length)
            return res.status(400).send({ error: "No images provided" });

          const result = await storiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $push: { images: { $each: images } } }
          );
          res.send({ success: true, result });
        } catch (err) {
          res.status(500).send({ success: false, message: err.message });
        }
      }
    );

    // Remove specific image from story
    app.delete(
      "/stories/:id/images",
      verifyToken,
      verifyTouristOrGuide,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { imageUrl } = req.body;

          const result = await storiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $pull: { images: imageUrl } }
          );
          res.send({ success: true, result });
        } catch (err) {
          res.status(500).send({ success: false, message: err.message });
        }
      }
    );

    // Delete story
    app.delete(
      "/stories/:id",
      verifyToken,
      verifyTouristOrGuide,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await storiesCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount > 0)
            res.send({ success: true, message: "Story deleted successfully" });
          else
            res
              .status(404)
              .send({ success: false, message: "Story not found" });
        } catch (err) {
          res.status(500).send({ success: false, message: err.message });
        }
      }
    );

    // =======================
    // Admin Stats API
    // =======================

    app.get("/api/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const email = req.user.email;

        const admin = await usersCollection.findOne({ email });
        if (!admin || admin.role !== "admin") {
          return res
            .status(403)
            .send({ error: true, message: "Forbidden Access" });
        }

        const totalPayment = await bookingsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                total: {
                  $sum: { $toDouble: "$totalPrice" },
                },
              },
            },
          ])
          .toArray();

        res.send({
          totalPayment: totalPayment[0]?.total || 0,
          totalGuides: await usersCollection.countDocuments({ role: "guide" }),
          totalPackages: await packagesCollection.countDocuments(),
          totalClients: await usersCollection.countDocuments({
            role: "tourist",
          }),
          totalUsers: await usersCollection.countDocuments({
            role: "user",
          }),
          totalStories: await storiesCollection.countDocuments(),
        });
      } catch (error) {
        res
          .status(500)
          .send({ error: true, message: "Failed to load admin stats", error });
      }
    });

    // ====================
    // Ping DB
    // ====================
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // optionally keep client open for app lifetime
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Assignment 12 Server..");
});

app.listen(port, () => {
  console.log(`Assignment is running on port ${port}`);
});
