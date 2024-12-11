import mongoose from "mongoose";
import ValidatorData from "./Validator.js";

export const connectDB = async () => {
  try {
    console.log(process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB SolanaValidator connected");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
};

// Function to fetch data from the database
export const fetchSecretKeys = async () => {
  try {
    // Fetch all documents and get only the `name` field
    const validators = await ValidatorData.find({}, "name"); // Use projection to fetch only the `name` field
    const secretKeys = validators.map((validator) => validator.name);
    return secretKeys;
  } catch (error) {
    console.error("Error fetching names:", error);
    return null;
  }
};
