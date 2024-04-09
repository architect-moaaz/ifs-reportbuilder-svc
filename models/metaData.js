const mongoose = require("mongoose");

const metaDataScheme = new mongoose.Schema({
  workSpaceName: {
    type: String,
    required: true,
  },
  reportName: {
    type: String,
    required: true,
  },
  dbName: {
    type: String,
    required: true,
  },
  crossAppFilter: [
    {
      type: Object,
      required: false,
    },
  ],
  filter: {
    type: Object,
    required: false,
  },
  sort: {
    type: Object,
    required: false,
  },
  tables: [
    {
      type: Object,
      required: false,
    },
  ],
  projection: {
    type: Object,
    required: false,
  },
  reportDesc: {
    type: Object,
    required: false,
  },
  status: {
    type: String,
    required: false,
    default: "Draft",
  },
  reportType: {
    type: String,
    required: false,
  },
  createdBy: {
    type: Object,
    required: false,
  },
  createdOn: {
    type: Date,
    required: false,
    default: Date.now,
  },
  lastAccessesOn: {
    type: Date,
    required: false,
    default: Date.now,
  },
}, { 
  // Define a unique index for the combination of workSpaceName and reportName
  index: { 
    unique: true, 
    partialFilterExpression: {
      workSpaceName: { $exists: true },
      reportName: { $exists: true }
    }
  } 
});

metaDataScheme.index({ workSpaceName: 1, reportName: 1 }, { unique: true });

module.exports = mongoose.model("MetaData", metaDataScheme);
