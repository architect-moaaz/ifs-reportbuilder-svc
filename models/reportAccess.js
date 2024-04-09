const mongoose = require("mongoose");

const reportAccessSchema = new mongoose.Schema({
  workSpaceName: {
    type: String,
    required: true,
  },
  reportName: {
    type: String,
    required: true,
  },
  userName: [{
    type: String,
    required: false,
    default: "None",
  }],
  group: [{
    type: String,
    required: false,
    defualt: "None",
  }],
},{
  // Define a unique index for the combination of workSpaceName and reportName
  index: {
    unique: true,
    partialFilterExpression: {
      workSpaceName: { $exists: true },
      reportName: { $exists: true }
    }
  }
});

reportAccessSchema.index({ workSpaceName: 1, reportName: 1 }, { unique: true });

module.exports = mongoose.model("ReportAccess", reportAccessSchema);
