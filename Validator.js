import mongoose from "mongoose";

const ValidatorSchema = new mongoose.Schema({
  name: String,
  timestamp: {
    type: String,
    required: true,
  },
});

const ValidatorData = mongoose.model("validator", ValidatorSchema);

export default ValidatorData;
