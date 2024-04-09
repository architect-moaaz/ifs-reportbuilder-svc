const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const reportQueueSchema = new Schema({
  reportId: {
    type: String,
    required: true,
  },
  reportName: {
    type: String,
    required: true,
  },
  workspace: {
    type: String,
    required: true,
  },
  user: {
    type: String,
    required: true,
  },
  ttl: {
    type: Number
  },
  queuedTime: {
    type: Date,
    required: false,
    default: Date.now,
  },
  reportGenerationStartTime: {
    type: Date,
    required: false,
    default: Date.now,
  },
  reportGenerationEndTime: {
    type: Date,
    required: false,
    default: Date.now,
  },
  status: {
    type: String,
    required: true,
  },
  reportType: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    required: true,
  },
  fileInfo: {
    type: Object,
    required: false,
  },
  fileURL: {
    type: String,
    required: false,
  },
  remarks: {
    type: String,
  },
  timeZone: {
    type: String,
    required: false,
    default: "Asia/Kolkata",
  },
  languageTag: {
    type: String,
    required: false,
    default: "en-IN",
  },
  hourCycle: {
    type: String,
    required: false,
    default: "h23",
  },
});
const ReportQueue = mongoose.model("ReportQueue", reportQueueSchema);
module.exports = ReportQueue;
