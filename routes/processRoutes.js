const express = require("express");
const router = express.Router();
const MongoClient = require("mongodb").MongoClient;
const MetaData = require("../models/metaData");
const ReportQueue = require("../models/reportQueue");
const ReportAccess = require("../models/reportAccess");
const helmet = require("helmet");
const path = require("path");
const cors = require("cors");
const fs = require("fs-extra");
const archiver = require("archiver");
router.use(helmet());
router.use(cors());
const { unflatten } = require('flat');
const { format } = require('date-fns');
var { mongDb,name, connectionString, reportLocation,formatDatesInArrayOfObjects } = require("../db");

var {
  generateMultipleModelReport,
  generateProcessReport,
  getReportFromApacheDrill,
} = require("../utils/reportDownloadUtils");

console.log("connected to the DB: " + connectionString);

let db;
(async () => {
  try {
    const client = new MongoClient(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    db = client.db(name);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
})();

let client = null;

async function getMongoClientConnection() {
  if (!client) {
    client = await MongoClient.connect(connectionString);
  }
  return client;
}

router.get("/getAllAppDataBases", async (req, res) => {
  MongoClient.connect(connectionString)
    .then(async (client) => {
      const adminDb = client.db("admin");
      const workspace = req.headers.workspace;
      try {
        const result = await adminDb.admin().listDatabases();
        const dbNames = result.databases
          .filter((db) => {
            const nameParts = db.name.split("-");
            const firstPart = nameParts[0];
            return (
              firstPart.toLowerCase() === workspace.toLowerCase() &&
              !db.name.toLowerCase().includes("control")
            );
          })
          .map((db) => {
            const nameParts = db.name.split("-");
            return nameParts.slice(1).join("-");
          });

        const collectionsWithSchema = {};
        for (const dbName of dbNames) {
          const dbNameAppendingWorkspace = req.headers.workspace + "-" + dbName;
          const db = client.db(dbNameAppendingWorkspace);
          const collectionsResult = await db.listCollections().toArray();
          const collectionNames = collectionsResult.map((c) => c.name);
          collectionsWithSchema[dbName] = collectionNames;
        }

        res.json({ collectionsWithSchema });
      } catch (err) {
        console.error(err);
        client.close();
      } finally {
        client.close();
      }
    })
    .catch((err) => {
      res.status(500).json({ message: err.message });
    });
});

async function getCollectionsFromDb(dbName) {
  try {
    const client = await getMongoClientConnection();
    const connect = client.db(dbName);
    const cursor = connect.listCollections();
    const firstResult = await cursor.toArray();
    const collectionNames = firstResult.map((name) => name.name);
    return collectionNames;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

router.get("/getCollectionSchema", async (req, res, cb) => {
  try {
    var collections = [];
    if (req.headers.app) {
      var dbName = req.headers.workspace + "-" + req.headers.app;
      mongDb = mongDb.useDb(dbName);
      collections.push(req.headers.datamodel);
    } else {
      var gettingProcess = true;
    }
    let result = {};
    for (i in collections) {
      var collectionName = collections[i];
      if (collectionName.includes("meta")) continue;
      var schemaObj = await mongDb.collection(collectionName).findOne();
      const unflattenedObject = await flattenJSON(schemaObj);
      result[collectionName] = unflatten(unflattenedObject);
    }
    if (gettingProcess) {
      collections.push("processes");
      mongDb = mongDb.useDb("k1");
      var schemaObj = await mongDb.collection("processes").findOne();
      result["processes"] = await flattenJSON(schemaObj);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

async function flattenJSON(obj = {}, res = {}, extraKey = "") {
  for (var key in obj) {
    if (Number(key) > 0) {
      continue;
    }
    if (obj[key] === "null" || obj[key] === null) {
      res[extraKey + key] = "string";
    } else if (typeof obj[key] !== "object" && typeof obj[key] !== "function") {
      res[extraKey + key] = typeof obj[key];
    } else {
      flattenJSON(obj[key], res, `${extraKey}${key}.`);
    }
  }
  return res;
}

router.post("/listAllReports", async (req, res, cb) => {
  try {
    let groupsFromToken = req.body.token["groups"];
    let userName =
      req.body.token["username"] === undefined
        ? req.body.token["preferred_username"]
        : req.body.token["username"];
    const role = req.headers.role;
    let options = {
      allowDiskUse: true,
    };
    let workSpaceName = req.headers.workspacename;
    if (workSpaceName == null || workSpaceName == undefined) {
      res.json({
        message:
          "Please pass the workspace name in the headers to get the list of reports.",
      });
      return cb(
        "Please pass the workspace name in the headers to get the list of reports."
      );
    }

    let page =
      req.query.page == undefined || req.query.page <= 0
        ? 1
        : parseInt(req.query.page);
    let size =
      req.query.size == undefined || req.query.size <= 0
        ? 10
        : parseInt(req.query.size);
    page = (page - 1) * size;

    var pipeline = [
      {
        $match: {
          workSpaceName: workSpaceName,
        },
      },
      {
        $lookup: {
          from: "reportaccesses",
          localField: "reportName",
          foreignField: "reportName",
          as: "reportaccesses",
        },
      },
      {
        $unwind: "$reportaccesses",
      },
      {
        $match: {
          "reportaccesses.workSpaceName": workSpaceName,
          $or: [
            { "reportaccesses.userName": userName },
            { "reportaccesses.group": { $in: groupsFromToken } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          workSpaceName: "$workSpaceName",
          reportName: "$reportName",
          status: "$status",
          reportType: "$reportType",
          reportDesc: "$reportDesc",
          createdBy: "$createdBy",
          createdOn: "$createdOn",
          appName: "$dbName",
          lastAccessesOn: "$lastAccessesOn",
          userName: "$reportaccesses.userName",
          group: "$reportaccesses.group",
        },
      },
      {
        $sort: {
          lastAccessesOn: -1,
        },
      },
      {
        $match: {
          status: { $ne: "DELETED" }
        }
      },
    ];
    const sort = req.body.sort;
    if (sort) {
      const sortObj = Object.fromEntries(Object.entries(sort));
      pipeline.push({
        $sort: sortObj,
      });
    }
    
    const reportName = req.headers.reportname;
    if (reportName) {
      pipeline.push({
        $match: {
          reportName: {
            $regex: reportName,
            $options: "i",
          },
        },
      });
      pipeline.push({
        $addFields: {
          isExactMatch: {
            $eq: ["$reportName", reportName],
          },
        },
      });
      pipeline.push({
        $sort: {
          isExactMatch: -1,
          reportName: 1,
        },
      });
    }
    if(role === "user"){
      pipeline.push({
        $match: {
          status: "PUBLISHED"
        }
      });
    }
    const timeZone = req.headers.timezone;
    const languageTag = req.headers.languagetag;
    const hourCycle = req.headers.hourcycle;
    let countPipe = [...pipeline];
    let cursor = db
      .collection("metadatas")
      .aggregate(pipeline, options)
      .skip(page)
      .limit(size);
    let result = await cursor.toArray();
    result = await formatDatesInArrayOfObjects(result,timeZone,languageTag,hourCycle);
    if (result.length === 0) {
      res.json({
        message: `No Reports present in the system for ${workSpaceName} workspace`,
      });
      return cb(
        `No Reports present in the system for ${workSpaceName} workspace`
      );
    } else {
      let data = await getTotalRecordsAndData(countPipe,result,req.query.page,req.query.size,"metadatas");
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

async function getTotalRecordsAndData(pipeline,data,page,size,table){
    var options = {
      allowDiskUse: true,
    };
    pipeline.push({
        $count: "totalRecords"
    })
      let responseBe = {};
      if(page === '1' || page === 1){
      var cursor = db
        .collection(table)
        .aggregate(pipeline, options)
      var result = await cursor.toArray();
      let totalCount = result[0].totalRecords;
      let totalPages = Math.ceil(totalCount / (size ? size : 10));
      let metaData = {};
      metaData["totalCount"] = totalCount;
      metaData["totalPages"] = totalPages;
      responseBe['metaData'] = metaData;
    }
    responseBe['data'] = data;
   return responseBe; 
}

router.get("/getReport", checkReportAccessibility, async (req, res) => {
  try {
    var exportDataAs = req.headers.exportdatato;
    const reportMetaData = await db.collection("metadatas").findOne({
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    });

    if (reportMetaData === null) {
      res.status(404).json({
        message: `No report present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
      return;
    }
    await db.collection("metadatas").updateOne(
      {
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
      },
      { $set: { lastAccessesOn: new Date() } }
    );
    const date = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const formattedDate = formatter.format(date);
    const reportQueue = new ReportQueue({
      reportId: req.headers.reportname + "-" + formattedDate,
      reportName: req.headers.reportname,
      workspace: req.headers.workspacename,
      queuedTime: formattedDate,
      reportGenerationStartTime: formattedDate,
      reportGenerationEndTime: formattedDate,
      status: "Queued",
      reportType: "singleModel",
      fileType: exportDataAs,
    });

    if (
      exportDataAs == "excel" ||
      exportDataAs == "csv" ||
      exportDataAs == "pdf" ||
      exportDataAs == "xlsx"
    ) {
      await reportQueue.save();
      return res.json({
        message:
          "The report download request is added to the queue, You will be able to download the report when it is generated.",
      });
    }
    const data = await generateProcessReport(
      reportMetaData.projection,
      reportMetaData.filter,
      reportMetaData.tables,
      reportMetaData.sort,
      reportMetaData.dbName,
      req.query.page,
      req.query.size,
      false
    );
    if (data.length === 0) {
      res.json({
        message:
          "There is no data in the system with passed filters,projection Or The filter,projection passed might be incorrect.",
      });
    } else {
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/getReport/v2", checkReportAccessibility, async (req, res) => {
  try {
    var exportDataAs = req.headers.exportdatato;
    const reportMetaData = await db.collection("metadatas").findOne({
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    });

    if (reportMetaData === null) {
      res.status(404).json({
        message: `No report already present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
      return;
    }
    await db.collection("metadatas").updateOne(
      {
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
      },
      { $set: { lastAccessesOn: new Date() } }
    );
    const date = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const formattedDate = formatter.format(date);
    var count = await db.collection("reportqueues").countDocuments();
    count++;
    var userName =
      req.body.token["username"] === undefined
        ? req.body.token["preferred_username"]
        : req.body.token["username"];
    const reportQueue = new ReportQueue({
      reportId: req.headers.reportname + "-" + count,
      //reportId: formattedDate,
      reportName: req.headers.reportname,
      workspace: req.headers.workspacename,
      user: userName,
      ttl: req.headers.ttl ? req.headers.ttl : 3,
      queuedTime: new Date(),
      reportGenerationStartTime: new Date(),
      reportGenerationEndTime: new Date(),
      status: "Queued",
      reportType: "multiModel",
      fileType: exportDataAs,
      timeZone: req.headers.timezone,
      languageTag: req.headers.langlanguagetag,
      hourCycle: req.headers.hourcycle
    });
    if (req.body.sort) {
      reportMetaData.sort = req.body.sort;
    }
    if (
      exportDataAs == "excel" ||
      exportDataAs == "csv" ||
      exportDataAs == "pdf" ||
      exportDataAs == "xlsx"
    ) {
      await reportQueue.save();
      return res.json({
        message:
          "The report download request is added to the queue, You will be able to download the report when it is generated.",
      });
    }
    let data = await getReportFromApacheDrill(
      req.query.page,
      req.query.size,
      reportMetaData,
    );
    const timeZone = req.headers.timezone;
    const languageTag = req.headers.languagetag;
    const hourCycle = req.headers.hourcycle;
    data = await formatDatesInArrayOfObjects(data,timeZone,languageTag,hourCycle);
    // const data = await generateMultipleModelReport(
    //   req.query.page,
    //   req.query.size,
    //   reportMetaData,
    //   false
    // );
    if (data.length === 0) {
      res.json({
        message:
          "There is no data in the system with passed filters,projection Or The filter,projection passed might be incorrect.",
      });
    } else {
      let responseBe = {};
      if(req.query.page === '1' || req.query.page === 1){
      let totalRecords = await getReportFromApacheDrill(
        req.query.page,
        req.query.size,
        reportMetaData,
        "count"
      );
      let totalCount = totalRecords[0].totalRecords;
      let totalPages = Math.ceil(totalCount / (req.query.size ? req.query.size : 10));
      let metaData = {};
      metaData["totalCount"] = totalCount;
      metaData["totalPages"] = totalPages;
      responseBe['metaData'] =  metaData;
      }
      responseBe['data'] = data;
      res.json(responseBe);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/getReportMetaData", checkReportAccessibility, async (req, res) => {
  const query = {
    workSpaceName: req.headers.workspacename,
    reportName: req.headers.reportname,
  };
  const projection = {
    workSpaceName: 1,
    reportName: 1,
    tables: 1,
    filter: 1,
    projection: 1,
    sort: 1,
    appName: "$dbName",
    _id: 0,
  };
  try {
    const cursor = db.collection("metadatas").find(query).project(projection);
    let result = await cursor.toArray();
    if (result === undefined) {
      return res.status(404).json({
        message: `No report already present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
    }
    if (result.length === 0) {
      return res.status(404).json({
        message: `No report already present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  "/createReportOrFetchData/:reportStatus/v2",
  async (req, res, cb) => {
    try {
      await createReportOrFetchData(req, res, cb);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

async function createReportOrFetchData(req, res, cb) {
  var dbName = req.headers.app;
  if(!dbName){
    dbName = "k1";
  }
  if (req.body.crossAppFilter) {
    var reportType = "multiApp";
  } else {
    var reportType = "multiModel";
  }
  if (req.params.reportStatus.toLocaleLowerCase() == "draft") {
    var status = "DRAFT";
  } else if (req.params.reportStatus.toLocaleLowerCase() == "saved") {
    var status = "SAVED";
  } else if (req.params.reportStatus.toLocaleLowerCase() == "edit") {
    var status = "EDIT";
  } else if (req.params.reportStatus.toLocaleLowerCase() == "fetchdata") {
    var status = "fetchdata";
  } else {
    res.status(400).json({
      message: `Invalid report status.`,
    });
    return cb(`Invalid report status.`);
  }
  var userName =
    req.body.token["username"] === undefined
      ? req.body.token["preferred_username"]
      : req.body.token["username"];
  const metaData = new MetaData({
    workSpaceName: req.headers.workspacename,
    reportName: req.headers.reportname,
    tables: req.body.tables,
    filter: req.body.filter,
    sort: req.body.sort,
    dbName: dbName,
    crossAppFilter: req.body.crossAppFilter,
    status: status,
    reportType: reportType,
    projection: req.body.projection,
    reportDesc: req.body.reportDesc,
    createdBy: req.body.createdBy == null ? userName : req.body.createdBy,
    createdOn:
      req.body.createdOn == undefined ? new Date() : req.body.createdOn,
    lastAccessesOn:
      req.body.lastAccessesOn == undefined
        ? new Date()
        : req.body.lastAccessesOn,
  });
  if (status == "DRAFT" || status == "SAVED" || status == "EDIT") {
    const reportMetaData = await db.collection("metadatas").findOne({
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    });
    if (reportMetaData) {
      res.status(401).json({
        message: `Report already present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
      return cb(
        `Report already present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`
      );
    }
    var userName =
      req.body.token["username"] === undefined
        ? req.body.token["preferred_username"]
        : req.body.token["username"];
    if (userName === undefined || userName === null) {
      res.status(401).json({
        message:
          "The request headers should contain userName or user token should be passed to validate the user for report access",
      });
      return cb(
        "The request headers should contain userName or user token should be passed to validate the user for report access"
      );
    }
    const reportAccess = new ReportAccess({
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
      userName: userName,
    });
    var projectObj = {};
    for (var key in metaData.projection) {
      var projectionKey = key.split(".").pop();
      projectionKey =
        projectionKey.charAt(0).toUpperCase() + projectionKey.slice(1);
      projectObj[projectionKey] = metaData.projection[key];
    }
    metaData.projection = projectObj;
    await metaData.save();
    await reportAccess.save();
  }
  let data = await getReportFromApacheDrill(
      req.query.page,
      req.query.size,
      metaData
  );
  const timeZone = req.headers.timezone;
  const languageTag = req.headers.languagetag;
  const hourCycle = req.headers.hourcycle;
  data = await formatDatesInArrayOfObjects(data,timeZone,languageTag,hourCycle);
  // const data = await generateMultipleModelReport(
  //   req.query.page,
  //   req.query.size,
  //   metaData,
  //   false
  // );
  if (data.length === 0) {
    res.json({
      message:
        "There is no data in the system with passed filters,projection Or The filter,projection passed might be incorrect.",
    });
  } else {
    let responseBe = {};
    if(req.query.page === '1' || req.query.page === 1){
    let totalRecords = await getReportFromApacheDrill(
      req.query.page,
      req.query.size,
      metaData,
      "count"
    );
    let totalCount = totalRecords[0].totalRecords;
    let totalPages = Math.ceil(totalCount / (req.query.size ? req.query.size : 10));
    let info = {};
    info["totalCount"] = totalCount;
    info["totalPages"] = totalPages;
    responseBe['metaData'] = info;
    }
    responseBe['data'] = data;
    res.json(responseBe);
  }
}

router.post("/createReport", async (req, res, cb) => {
  try {
    if (req.headers.app) {
      var dbName = req.headers.workspace + "-" + req.headers.app;
    } else {
      var dbName = "k1";
    }
    const saveReport = req.headers.savereport;
    const metaData = new MetaData({
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
      dbName: dbName,
      tables: req.body.tables,
      filter: req.body.filter,
      tables: req.body.tables,
      status: req.body.status,
      sort: req.body.sort,
      reportType: "singleModel",
      projection: req.body.projection,
      reportDesc: req.body.reportDesc,
      createdBy: req.body.createdBy == null ? userName : req.body.createdBy,
      createdOn:
        req.body.createdOn == undefined ? new Date() : req.body.createdOn,
      lastAccessesOn:
        req.body.lastAccessesOn == undefined
          ? new Date()
          : req.body.lastAccessesOn,
    });
    if (saveReport && saveReport == "true") {
      const reportMetaData = await db.collection("metadatas").findOne({
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
      });
      if (reportMetaData) {
        res.status(401).json({
          message: `Report already present with name: ${req.headers.reportname} in the workspace: ${req.headers.workspacename}.`,
        });
        return cb(
          `Report already present with name: ${req.headers.reportname} in the workspace: ${req.headers.workspacename}.`
        );
      }
      var userName =
        req.body.token["username"] === undefined
          ? req.body.token["preferred_username"]
          : req.body.token["username"];
      if (userName === undefined || userName === null) {
        res.status(401).json({
          message:
            "The request headers should contain userName or user token should be passed to validate the user for report access",
        });
        return cb(
          "The request headers should contain userName or user token should be passed to validate the user for report access"
        );
      }
      var projectObj = {};
      for (var key in metaData.projection) {
        var projectionKey = key.split(".").pop();
        projectionKey =
          projectionKey.charAt(0).toUpperCase() + projectionKey.slice(1);
        projectObj[projectionKey] = metaData.projection[key];
      }
      metaData.projection = projectObj;
      await metaData.save();
      const reportAccess = new ReportAccess({
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
        userName: userName,
      });
      await reportAccess.save();
    }
    const data = await generateProcessReport(
      metaData.projection,
      metaData.filter,
      metaData.tables,
      metaData.sort,
      metaData.dbName,
      req.query.page,
      req.query.size,
      false
    );
    if (data.length === 0) {
      res.json({
        message:
          "There is no data in the system with passed filters,projection Or The filter,projection passed might be incorrect.",
      });
    } else {
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/deleteReport", checkReportAccessibility, async (req, res) => {
  try {
    const query = {
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    };
    await db.collection("metadatas").deleteOne(query);
    await db.collection("reportaccesses").deleteOne(query);
    res.json({
      message: `Report delete with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete(
  "/softDeleteReport",
  checkReportAccessibility,
  async (req, res) => {
    try {
      await db.collection("metadatas").updateOne(
        {
          workSpaceName: req.headers.workspacename,
          reportName: req.headers.reportname,
        },
        { $set: { status: "DELETED" , reportName: req.headers.reportname + "-Deleted",} }
      );
      await db.collection("reportaccesses").updateOne({
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
      },
      { $set: {reportName: req.headers.reportname + "-Deleted",} });
      res.json({
        message: `Report soft deleted with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/updateReportMetaData",
  checkReportAccessibility,
  async (req, res, cb) => {
    var query = {
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    };
    try {
      const reportMetaData = await db.collection("metadatas").findOne({
        workSpaceName: req.headers.workspacename,
        reportName: req.headers.reportname,
      });
      if (reportMetaData.status == "PUBLISHED") {
        const reportMetaDataDraft = await db.collection("metadatas").findOne({
          workSpaceName: req.headers.workspacename,
          reportName: req.headers.reportname + "-DRAFT",
        });
        if (!reportMetaDataDraft) {
          req.headers.reportname = req.headers.reportname + "-DRAFT";
          req.params.reportStatus = "edit";
          req.headers.app = reportMetaData.dbName;
          await createReportOrFetchData(req, res, cb);
          return;
        }else{
          query['reportName'] = req.headers.reportname + "-DRAFT";
          var status = "EDIT";
        }
      }
      if (
        req.headers.savereport &&
        req.headers.savereport.toLocaleLowerCase() == "true"
      ) {
        var status = "SAVED";
      }
      const setFields = {
        dbName: reportMetaData.dbName,
        crossAppFilter: req.body.crossAppFilter,
        filter: req.body.filter,
        projection: req.body.projection,
        tables: req.body.tables,
        sort: req.body.sort,
        reportDesc: reportMetaData.reportDesc,
        createdBy: reportMetaData.createdBy,
        createdOn: reportMetaData.createdOn,
        status: status ? status : reportMetaData.status,
        reportType: reportMetaData.reportType,
        lastAccessesOn: reportMetaData.lastAccessesOn,
      };
      Object.keys(setFields).forEach(
        (key) => setFields[key] == null && delete setFields[key]
      );
      const updated = await db
        .collection("metadatas")
        .findOneAndUpdate(
          query,
          { $set: setFields },
          { returnDocument: "after" }
        );
      res.json({ updated });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

async function updateReportStatus(req, status) {
  await db.collection("metadatas").updateOne(
    {
      workSpaceName: req.headers.workspacename,
      reportName: req.headers.reportname,
    },
    { $set: { status: status } }
  );
}

router.get(
  "/getReportAccessUsersAndGroups",
  checkReportAccessibility,
  async (req, res) => {
    let reportName = req.headers.reportname;
    if(req.headers.status && req.headers.status.toLocaleLowerCase() === "edit"){
      reportName = reportName.replace('-DRAFT', '')
    }
    const query = {
      workSpaceName: req.headers.workspacename,
      reportName: reportName,
    };
    const projection = { reportName: 1, userName: 1, group: 1, _id: 0 };
    try {
      const cursor = db
        .collection("reportaccesses")
        .find(query)
        .project(projection);
      let result = await cursor.toArray();
      if (result === undefined) {
        return res.status(404).json({
          message: `No report present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
        });
      }
      if (result.length === 0) {
        return res.status(404).json({
          message: `No report present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
        });
      }
      res.json(result[0]);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/updateReportAccessUsersAndGroups",
  checkReportAccessibility,
  async (req, res) => {
    try {
      if (req.headers.reportname.endsWith("-DRAFT")) {
        var report = req.headers.reportname.slice(0, -6);
        var query = {
          workSpaceName: req.headers.workspacename,
          reportName: report,
        };
        await db.collection("metadatas").deleteOne({
          workSpaceName: req.headers.workspacename,
          reportName: report,
        });
        await db.collection("reportaccesses").deleteOne({
          workSpaceName: req.headers.workspacename,
          reportName: req.headers.reportname,
        });
        await db.collection("metadatas").updateOne(
          {
            workSpaceName: req.headers.workspacename,
            reportName: req.headers.reportname,
          },
          { $set: { reportName: report, status: "PUBLISHED" } }
        );
      } else {
        await updateReportStatus(req, "PUBLISHED");
        var query = {
          workSpaceName: req.headers.workspacename,
          reportName: req.headers.reportname,
        };
      }
      const update = { userName: req.body.userName, group: req.body.group };
      var reportAccess = await ReportAccess.findOneAndUpdate(query, update, { new: true });
      res.json(reportAccess);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get("/getDownloadedReports", async (req, res, cb) => {
  try {
    var groupsFromToken = req.body.token["groups"];
    var userName =
      req.body.token["username"] === undefined
        ? req.body.token["preferred_username"]
        : req.body.token["username"];
    var options = {
      allowDiskUse: true,
    };
    let workSpaceName = req.headers.workspacename;
    if (workSpaceName == null || workSpaceName == undefined) {
      res.json({
        message:
          "Please pass the workspace name in the headers to get the list of reports.",
      });
      return cb(
        "Please pass the workspace name in the headers to get the list of reports."
      );
    }
    var reportName = req.headers.reportname;
    let page =
      req.query.page == undefined || req.query.page <= 0
        ? 1
        : parseInt(req.query.page);
    let size =
      req.query.size == undefined || req.query.size <= 0
        ? 10
        : parseInt(req.query.size);
    page = (page - 1) * size;

    var pipeline = [
      {
        $match: {
          workspace: workSpaceName,
          user: userName,
        },
      },
      {
        $lookup: {
          from: "reportaccesses",
          localField: "reportName",
          foreignField: "reportName",
          as: "reportaccesses",
        },
      },
      {
        $unwind: "$reportaccesses",
      },
      {
        $match: {
          "reportaccesses.workSpaceName": workSpaceName,
          $or: [
            { "reportaccesses.userName": userName },
            { "reportaccesses.group": { $in: groupsFromToken } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          reportId: 1,
          reportName: 1,
          workspace: 1,
          user: 1,
          status: 1,
          reportType: 1,
          fileType: 1,
          queuedTime: 1,
          reportGenerationStartTime: 1,
          reportGenerationEndTime: 1,
          fileURL: 1,
          remarks: 1,
        },
      },
      {
        $sort: {
          queuedTime: -1,
        },
      },
    ];
    if (reportName) {
      pipeline.splice(1, 0, {
        $match: {
          reportName: reportName,
        },
      });
    }
    const timeZone = req.headers.timezone;
    const languageTag = req.headers.languagetag;
    const hourCycle = req.headers.hourcycle;
    let countPipe = [...pipeline];
    var cursor = db
      .collection("reportqueues")
      .aggregate(pipeline, options)
      .skip(page)
      .limit(size);
    var result = await cursor.toArray();
    result = await formatDatesInArrayOfObjects(result,timeZone,languageTag,hourCycle);
    if (result.length === 0) {
      res.json({
        message: `No Reports present in the system for ${workSpaceName} workspace`,
      });
      return cb(
        `No Reports present in the system for ${workSpaceName} workspace`
      );
    } else {
      let data = await getTotalRecordsAndData(countPipe,result,req.query.page,req.query.size,"reportqueues");
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get(
  "/downloadReport/:reportId",
  checkReportAccessibility,
  async (req, res) => {
    const reportId = req.params.reportId;
    var documentsPath = path.normalize(
      `${process.env.HOME.trim()}/${reportLocation.trim()}/${reportId.trim()}`
    );
    if (!fs.existsSync(documentsPath)) {
      return res
        .status(404)
        .send({ message: "The report was not downloaded or deleted" });
    }
    const files = fs.readdirSync(documentsPath);
    if (files.length == 0) {
      return res
        .status(404)
        .send({ message: "The report was not downloaded or deleted" });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${reportId}.zip`
    );
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    files.forEach((file) => {
      const filePath = path.join(documentsPath, file);
      const fileStream = fs.createReadStream(filePath);
      archive.append(fileStream, { name: file });
    });
    archive.finalize();
  }
);

router.get(
  "/downloadReport/:reportId/:fileName",
  checkReportAccessibility,
  async (req, res) => {
    const reportId = req.params.reportId;
    const fileName = req.params.fileName;
    const fileType = req.headers.filetype;
    var documentsPath = path.normalize(
      `${process.env.HOME.trim()}/${reportLocation.trim()}/${reportId.trim()}`
    );
    if (fileType == "xlsx" || fileType == "excel") {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename= ${fileName}.xlsx`
      );
      documentsPath = path.join(documentsPath, `${fileName}.xlsx`);
    } else if (fileType == "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename= ${fileName}.csv`
      );
      documentsPath = path.join(documentsPath, `${fileName}.csv`);
    } else {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename= ${fileName}.pdf`
      );
      documentsPath = path.join(documentsPath, `${fileName}.pdf`);
    }
    if (!fs.existsSync(documentsPath)) {
      return res
        .status(404)
        .send({ message: "The report was not downloaded or deleted" });
    }
    const fileStream = fs.createReadStream(documentsPath);
    fileStream.pipe(res);
  }
);

async function getUserListByReport(workSpaceName, reportName) {
  const reportMetaData = await db
    .collection("reportaccesses")
    .findOne({ workSpaceName: workSpaceName, reportName: reportName });
  return reportMetaData;
}

async function verifyGroupAndUser(req, res, next) {
  const userAndGroupList = await getUserListByReport(
    req.headers.workspacename,
    req.headers.reportname
  );
  if (userAndGroupList === undefined || userAndGroupList === null) {
    res.status(404).json({
      message: `No report present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`,
    });
    return next(
      `No report present with name: ${req.headers.reportname} in the workspace ${req.headers.workspacename}.`
    );
  }
  const usersList = userAndGroupList.userName;
  const groupsList = userAndGroupList.group;
  var groupsFromToken = req.body.token["groups"];
  var userName =
    req.body.token["username"] === undefined
      ? req.body.token["preferred_username"]
      : req.body.token["username"];
  if (userName === undefined || userName === null) {
    res.status(401).json({
      message:
        "The request body should contain userName or user token should be passed to validate the user for report access",
    });
    return next(
      "The request body should contain userName or user token should be passed to validate the user for report access"
    );
  }
  if ((await usersList.includes(userName)) === true) {
    return true;
  }
  for (var value in groupsFromToken) {
    if ((await groupsList.includes(groupsFromToken[value])) === true) {
      return true;
    }
  }
  return false;
}

async function checkReportAccessibility(req, res, next) {
  if ((await verifyGroupAndUser(req, res, next)) === false) {
    res
      .status(401)
      .json({ message: "User does not have the access to this report" });
    return next("User does not have the access to this report");
  }
  next();
}

module.exports = router;
