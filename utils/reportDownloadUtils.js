const exceljs = require("exceljs");
const path = require("path");
const {
    Parser,
    transforms: {unwind, flatten},
} = require("json2csv");
const puppeteer = require("puppeteer");
const hbs = require("handlebars");
const fs = require("fs-extra");
const axios = require("axios");
const {PDFDocument} = require("pdf-lib");
const stream = require('stream');
const zlib = require("zlib");
const MongoClient = require("mongodb").MongoClient;
var {name,connectionString ,cdsApi, apacheDrillApi} = require("../db");
let UNNEST = "";

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

async function exportToExcel(actualData = {}, reportId, ttl, reportName) {
    const report = reportId;
    var splitData = await getDataForReport(actualData);
    var data = splitData.split("\n");
    const workBook = new exceljs.Workbook();
    const workSheet = workBook.addWorksheet(reportName);
    var columns = [];
    var headers = data[0].trim().replace(/["]/g, "").split(",");
    for (var key in headers) {
        columns.push({header: headers[key], key: headers[key], width: 20});
    }
    workSheet.columns = columns;
    for (var key in data) {
        if (key == 0) continue;
        var value = data[key].trim().replace(/["]/g, "").split(",");
        var element = {};
        for (var eleKey in headers) {
            element[headers[eleKey]] = value[eleKey];
        }
        workSheet.addRow(element);
    }
    workSheet.getRow(1).eachCell((cell) => {
        cell.font = {bold: true};
    });
    var file = await workBook.xlsx.writeBuffer();
    var formData = new FormData();
    const compressedBytes = zlib.gzipSync(file);
    formData.append(
        "file",
        new Blob([compressedBytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${report}.xlsx`
    );
    formData.append("filecompressed", true);
    //formData.append("file", new Blob([file]), report + ".xlsx");
    const apiUrl = `${cdsApi}/reportFiles/upload`;
    const response = await axios.post(apiUrl, formData, {
        headers: {
            "Content-Type": "multipart/form-data",
            "days": ttl
        },
    });
    if (response.statusText.toLowerCase() != "ok") {
        console.error(`Failed to upload file: ${response.statusText}`);
    } else {
        console.log(`File "${report}.xlsx" uploaded successfully!`);
        return response.data;
    }
}

async function exportToCsv(data, reportId, ttl) {
    try {
        const report = reportId;
        const csvData = await getDataForReport(data);
        var formData = new FormData();
        formData.append(
            "file",
            new Blob([csvData], {type: "text/csv"}),
            `${report}.csv`
        );
        const apiUrl = `${cdsApi}/reportFiles/upload`;
        const response = await axios.post(apiUrl, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
                "days": ttl
            },
        });
        if (response.statusText.toLowerCase() != "ok") {
            console.error(`Failed to upload file: ${response.statusText}`);
        } else {
            console.log(`File "${report}.csv" uploaded successfully!`);
            return response.data;
        }
    } catch (error) {
        console.error(error.message);
    }
}

const compile = async function (data) {
    const filePath = path.join(process.cwd(), "templates", `pdfTemplate.hbs`);
    const html = await fs.readFile(filePath, "utf8");
    return hbs.compile(html)(data);
};

async function exportToPdf(actualData, reportId, ttl, reportName) {
    const report = reportId;
    var splitData = await getDataForReport(actualData);
    var data = splitData.split("\n");
    var uniqueKeys = data[0].trim().replace(/["]/g, "").split(",");
    uniqueData = [];
    for (var key in data) {
        if (key == 0) continue;
        var value = data[key].trim().replace(/["]/g, "").split(",");
        var element = {};
        for (var eleKey in uniqueKeys) {
            element[uniqueKeys[eleKey]] = value[eleKey];
        }
        uniqueData.push(element);
    }
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-setuid-sandbox",
            "--no-sandbox",
        ],
        executablePath: process.env.CHROMIUM_PATH
            ? process.env.CHROMIUM_PATH
            : "/usr/bin/chromium-browser",
        userDataDir: "/tmp/puppeteer_user_data",
        cache: {
            path: "/tmp/puppeteer/cache",
        },
    });
    const page = await browser.newPage();
    const templateData = {
        uniqueKeys: uniqueKeys,
        data: uniqueData,
        title: `${reportName} Report`,
    };
    const content = await compile(templateData);
    const chunkSize = 1024 * 1024; // 1MB chunk size
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    const contentString = chunks.join('');
    await page.setContent(contentString, { waitUntil: 'networkidle0' });
    const formData = new FormData();
    const pdfData = await page.pdf({
        format: "A4",
        margin: {top: "100px", right: "50px", bottom: "100px", left: "50px"},
        printBackground: true,
        timeout: 0,
        preferCSSPageSize: true // Use CSS page size
    });
    const pdfDoc = await PDFDocument.load(pdfData);
    pdfDoc.setTitle(`${report} Report`);
    pdfDoc.setSubject(`${report} Report`);
    pdfDoc.setKeywords(["report", report]);
    const pdfBytes = await pdfDoc.save();
    const compressedPdfBytes = zlib.gzipSync(pdfBytes);
    formData.append(
        "file",
        new Blob([compressedPdfBytes], {type: "application/pdf"}),
        `${report}.pdf`
    );
    formData.append("filecompressed", true);
    const apiUrl = `${cdsApi}/reportFiles/upload`;
    const response = await axios.post(apiUrl, formData, {
        headers: {
            "Content-Type": "multipart/form-data",
            "days": ttl
        },
    });
    if (response.statusText.toLowerCase() != "ok") {
        console.error(`Failed to upload file: ${response.statusText}`);
    } else {
        console.log(`File "${report}.pdf" uploaded successfully!`);
        return response.data;
    }
}

async function getDataForReport(data) {
    var records = [];
    const csvFields = [];
    data.forEach((obj) => {
        records.push(obj);
    });
    let count = 0;
    for (var key in data) {
        if (count > 0) {
            break;
        }
        if (count == 0) {
            for (var keyOfKey in data[key]) {
                csvFields.push(keyOfKey);
            }
            count++;
        }
    }
    const transforms = [unwind({paths: csvFields}), flatten(".")];
    const csvParser = new Parser({
        csvFields,
        transforms,
    });
    return csvParser.parse(records);
}

async function generateProcessReport(
    projection,
    filter,
    tableName,
    sort,
    dbName,
    queryPage,
    querySize,
    reportFile
) {
    db = db.useDb(dbName);
    let page = queryPage == undefined || queryPage <= 0 ? 1 : parseInt(queryPage);
    let size =
        querySize == undefined || querySize <= 0 ? 10 : parseInt(querySize);
    page = (page - 1) * size;
    if (projection !== undefined || projection != null) {
        projection["_id"] = 0;
    }
    var collectionName = tableName.toString();
    if (
        collectionName == null ||
        collectionName == undefined ||
        collectionName.length == 0
    ) {
        collectionName = "processes";
    }
    var pipleLine = [];
    var keyCheck = [];
    var options = {
        allowDiskUse: true,
    };
    pipleLine.push({$match: filter == undefined ? {} : filter});
    const first = db
        .collection(collectionName)
        .aggregate([
            {$match: filter == undefined ? {} : filter},
            {
                $project: projection == undefined ? {document: "$$ROOT"} : projection,
            },
        ])
        .limit(10);
    var result = await first.toArray();
    const sortedObjects = result.sort(
        (a, b) => Object.keys(b).length - Object.keys(a).length
    );
    var obj = sortedObjects[0];
    for (i in obj) {
        if (typeof obj[i] == "object") {
            var $unwindkey = projection[i].split(".")[0];
            if (keyCheck.includes($unwindkey)) {
                continue;
            }
            var $unwind = {};
            $unwind["$unwind"] = $unwindkey;
            pipleLine.push($unwind);
            keyCheck.push($unwindkey);
        }
    }
    var _id = {};
    for (var key in projection) {
        if (key == "_id") continue;
        _id[key] = projection[key];
    }
    var $group = {};
    $group["_id"] = _id;
    $group["doc"] = {$first: "$$ROOT"};
    pipleLine.push({$group});
    pipleLine.push({
        $replaceRoot: {
            newRoot: "$doc",
        },
    });
    pipleLine.push({
        $project: projection == undefined ? {document: "$$ROOT"} : projection,
    });
    if (sort) {
        pipleLine.push({
            $sort: sort,
        });
    }
    if (reportFile) {
        const cursor = db.collection(collectionName).aggregate(pipleLine, options);
        return await cursor.toArray();
    } else {
        const cursor = db
            .collection(collectionName)
            .aggregate(pipleLine, options)
            .skip(page)
            .limit(size);
        return await cursor.toArray();
    }
}

async function createTempCollections(tempDbName, obj) {
    try {
        db = db.useDb(obj.appLoc);
        const filter = obj.filter || {};
        const projection = obj.projection || {_id: 0};
        await db
            .collection(obj.dataModel)
            .aggregate([
                {$match: filter},
                {$project: projection},
                {$out: {db: "tempDB", coll: tempDbName}},
            ])
            .toArray();
    } catch (err) {
        console.error(err);
    }
}

async function getSnapShotMeta(metaData) {
    var uniObj = {};
    for (i in metaData.tables) {
        var obj = metaData.tables[i];
        if (!uniObj[obj.table1]) {
            uniObj[obj.table1] = {};
        }
        if (!uniObj[obj.table1]["projection"]) {
            uniObj[obj.table1]["projection"] = {};
            uniObj[obj.table1]["projection"]["_id"] = 0;
        }
        if (!uniObj[obj.table2]) {
            uniObj[obj.table2] = {};
        }
        if (!uniObj[obj.table2]["projection"]) {
            uniObj[obj.table2]["projection"] = {};
            uniObj[obj.table2]["projection"]["_id"] = 0;
        }
        uniObj[obj.table1]["projection"][obj.on.table1Filter] = 1;
        uniObj[obj.table2]["projection"][obj.on.table2Filter] = 1;
    }
    for (i in metaData.projection) {
        var variable = metaData.projection[i].split(".");
        var key = variable[0].replace(/\$/g, "");
        if (!uniObj[key]) {
            uniObj[key] = {};
        }
        if (!uniObj[key]["projection"]) {
            uniObj[key]["projection"] = {};
        }
        uniObj[key]["projection"][variable[1]] = 1;
    }
    for (i in metaData.crossAppFilter) {
        var obj = metaData.crossAppFilter[i];
        key = obj.appLoc + "-" + obj.dataModel;
        if (!uniObj[key]) {
            uniObj[key] = {};
        }
        if (!uniObj[key]["filter"]) {
            uniObj[key]["filter"] = {};
        }
        uniObj[key]["appLoc"] = obj.appLoc;
        uniObj[key]["dataModel"] = obj.dataModel;
        uniObj[key]["filter"] = obj.filter;
    }
    for (i in uniObj) {
        await createTempCollections(i, uniObj[i]);
    }
}

async function addUNNEST(obj) {
    var str = obj.replace(/0./g, "").replace(/\$/g, "");
    var index = str.lastIndexOf(".");
    var newStr =
        "`" +
        str.substring(0, index).replace(/\./g, "`.`").replace(/-/g, "_") +
        "`";
    var variable = "`" + str.replace(/\.\w+$/, "").replace(/[\.-]/g, "_") + "`";
    var unnestJoin = ` CROSS JOIN UNNEST(${newStr}) AS ${variable}(${variable}) `;
    if (!UNNEST.includes(unnestJoin)) {
        UNNEST += unnestJoin;
    }
}

async function reorderObjectKeys(inputObject) {
    const outputObject = {};
    const keyOrder = ["table1", "joinType", "table2", "on"];
    if (inputObject.hasOwnProperty("on") && !inputObject.hasOwnProperty("joinType")) {
        inputObject.joinType = "inner";
    }
    for (const key of keyOrder) {
        if (inputObject.hasOwnProperty(key)) {
            outputObject[key] = inputObject[key];
        }
    }
    return outputObject;
}

async function createQuery(queryPage, querySize, metaData,dataOrCounts) {
    let query = "SELECT DISTINCT ";
    let page = queryPage === undefined || queryPage <= 0 ? 1 : parseInt(queryPage);
    let size =
        querySize === undefined || querySize <= 0 ? 10 : parseInt(querySize);
    page = (page - 1) * size;
    let tables = "";
    let projections = "";
    let where = "";
    for (i in metaData.projection) {
        if (metaData.projection[i].includes(".0")) {
            const str = metaData.projection[i].replace(/0./g, "").replace(/\$/g, "");
            const variable =
                "`" + str.replace(/\.\w+$/, "").replace(/[\.-]/g, "_") + "`";
            const lastDotIndex = str.lastIndexOf(".");
            const length = metaData.projection[i].length;
            if (metaData.projection[i][length - 1] === "0") {
                projections += `${variable}.${variable}` + " AS `" + i + "` ,";
            } else {
                const columnName =
                    "`" + str.substring(lastDotIndex + 1).replace(/[\.-]/g, "_") + "`";
                projections +=
                    `${variable}.${variable}.${columnName}` + " AS `" + i + "` ,";
            }
            await addUNNEST(metaData.projection[i]);
        } else {
            const project = metaData.projection[i].replace(/\./g, "`.`");
            let val = "`" + project + "`" + " AS `" + i + "` ,";
            val = val.replace(/-/g, "_").replace(/\$/g, "").replace(".`0`", "");
            projections += val;
        }
    }
    if (projections.length > 0) {
        projections = projections.slice(0, -1);
    }
    projections += " FROM ";
    let countJoins = 0;
    for (let i in metaData.tables) {
        const joins = await reorderObjectKeys(metaData.tables[i]);
        let counter = 0;
        let leftAlias = "";
        let rightAlias = "";
        for (j in joins) {
            if (j === "on") {
                const firstJoinCond = joins[j].table1Filter
                    .replace(/\./g, "`.`")
                    .replace(".`0`", "");
                const secondJoinCond = joins[j].table2Filter
                    .replace(/\./g, "`.`")
                    .replace(".`0`", "");
                tables +=
                    " ON `" +
                    leftAlias +
                    "`.`" +
                    firstJoinCond +
                    "` = `" +
                    rightAlias +
                    "`.`" +
                    secondJoinCond +
                    "`";
            } else {
                let joinType = " INNER JOIN ";
                if (j === "joinType") {
                    if (joins[j].toLocaleLowerCase() === "left") {
                        joinType = " LEFT JOIN ";
                    } else if (joins[j].toLocaleLowerCase() === "right") {
                        joinType = " RIGHT JOIN ";
                    } else if (joins[j].toLocaleLowerCase() === "outer") {
                        joinType = " FULL OUTER JOIN "
                    }
                    tables += joinType;
                    continue;
                }
                const table = joins[j].split(".");
                let alias = table[0] + "_" + table[1];
                alias = alias.replace(/-/g, "_");
                if (counter === 0) {
                    leftAlias = alias;
                } else {
                    rightAlias = alias;
                }
                if (countJoins === 0 || (countJoins > 0 && counter > 0)) {
                    tables +=
                        "`mongo`." +
                        "`" +
                        metaData.workSpaceName +
                        "-" +
                        table[0] +
                        "`.`" +
                        table[1] +
                        "` AS `" +
                        alias +
                        "`";
                }
                counter++;
            }
        }
        countJoins++;
    }
    if (metaData.filter) {
        // where = " WHERE " + (await buildWhereClause(metaData.filter));
        const filter = metaData.filter
            .replace(/-/g, "_");
        where = " WHERE " + filter;
    }
    query += projections + " " + tables + " " + UNNEST + " " + where;
    if (metaData.sort) {
        query += " ORDER BY ";
        for (i in metaData.sort) {
            if (metaData.sort[i] === -1) {
                query += i + " DESC,";
            } else {
                query += i + ",";
            }
        }
        query = query.slice(0, -1);
    }
    if(dataOrCounts !== "count"){
       query += ` LIMIT ${size} OFFSET ${page}`;
    }
    // console.info(
    //     `Query generated after taking in the report meta data: ${query}`
    // );
    return query;
}

async function buildWhereClause(filter, globalKey = "") {
    const operators = {
        $eq: "=",
        $ne: "<>",
        $gt: ">",
        $gte: ">=",
        $lt: "<",
        $lte: "<=",
        $like: "LIKE",
        $vvc: "=",
    };
    var check = false;
    let whereClause = "";
    const keys = Object.keys(filter);
    await Promise.all(
        keys.map(async (key) => {
            if (
                key.toLocaleLowerCase() === "$and" ||
                key.toLocaleLowerCase() === "$or"
            ) {
                const clauses = Array.isArray(filter[key])
                    ? filter[key]
                    : [filter[key]];
                const subClauses = await Promise.all(
                    clauses.map(async (clause) => await buildWhereClause(clause, key))
                );
                whereClause += `(${subClauses.join(
                    ` ${key.slice(1).toLocaleUpperCase()} `
                )})`;
                check = false;
            } else {
                const field = await modifyWhereConditionVariable(key);
                const value = filter[key];
                const operator =
                    value && typeof value === "object" ? Object.keys(value)[0] : ":";
                let comparisonValue =
                    value && typeof value === "object" ? value[operator] : value;
                if (operator === "$vvc") {
                    comparisonValue = await modifyWhereConditionVariable(comparisonValue);
                }
                const sqlOperator = operators[operator] || "=";
                if (sqlOperator === "LIKE") {
                    whereClause += `\`${field}\` ${sqlOperator} '${comparisonValue}' ${
                        globalKey === "$OR" ? "OR" : "AND"
                    } `;
                } else if (operator === "$vvc") {
                    whereClause += `\`${field}\` ${sqlOperator} ${
                        "`" + comparisonValue + "`"
                    } ${globalKey === "$OR" ? "OR" : "AND"} `;
                } else {
                    whereClause += `\`${field}\` ${sqlOperator} ${
                        typeof comparisonValue === "string"
                            ? `'${comparisonValue}'`
                            : comparisonValue
                    } ${globalKey === "$OR" ? "OR" : "AND"} `;
                }
                check = true;
            }
        })
    );
    if (check === true) {
        whereClause = whereClause.slice(0, -4);
    }
    return whereClause;
}

async function modifyWhereConditionVariable(key) {
    let field;
    if (typeof key == 'string' && key.includes(".0")) {
        const str = key.replace(/0./g, "").replace(/\$/g, "");
        field = key
            .replace(/\.0.*/, "")
            .replace(/[-.]/g, "_")
            .replace(/_$/, "");
        const lastDotIndex = str.lastIndexOf(".");
        const length = str.length;
        if (str[length - 1] === "0") {
            field = field + "`.`" + field;
        } else {
            var columnName = str
                .substring(lastDotIndex + 1)
                .replace(/[\.-]/g, "_");
            field = field + "`.`" + field + "`.`" + columnName;
        }
        await addUNNEST(key);
    } else if (typeof key == 'string') {
        field = key.replace(/-/g, "_").replace(/\./g, "`.`");
    }
    return field ? field : key;
}

async function getReportFromApacheDrill(queryPage, querySize, metaData,dataOrCount) {
    let query = await createQuery(queryPage, querySize, metaData,dataOrCount);
    if(dataOrCount === "count"){
        query = "SELECT count(*) AS totalRecords from ("+ query +" )";
    }
    const apiUrl = `${apacheDrillApi}/query.json`;
    const data = {
        queryType: "SQL",
        query: query,
    };
    const response = await axios.post(apiUrl, data);
    if (response.statusText.toLowerCase() !== "ok") {
        console.error(`Failed to upload file: ${response.statusText}`);
    } else {
        console.log(`Data fetched successfully from apache drill`);
        return response.data.rows ? response.data.rows : [];
    }
}

async function generateMultipleModelReport(
    queryPage,
    querySize,
    metaData,
    reportFile
) {
    var options = {
        allowDiskUse: true,
    };
    if (metaData.reportType == "multiApp") {
        await getSnapShotMeta(metaData);
        db = db.useDb("tempDB");
    } else {
        db = db.useDb(metaData.dbName);
    }
    var tables = metaData.tables;
    var pipleLine = [];
    let index = 0;
    let page = queryPage == undefined || queryPage <= 0 ? 1 : parseInt(queryPage);
    let size =
        querySize == undefined || querySize <= 0 ? 10 : parseInt(querySize);
    page = (page - 1) * size;
    var collection = "processes";
    if (tables) {
        var initialTable = tables[0].table1;
        collection = initialTable;
        var $project = {};
        $project["_id"] = 0;
        $project[initialTable] = "$$ROOT";
        pipleLine[index++] = {$project: $project};

        if (tables[0].table2) {
            $lookup = {};
            $lookup["from"] = tables[0].table2;
            $lookup["localField"] =
                tables[0].table1 + "." + tables[0].on.table1Filter;
            $lookup["foreignField"] = tables[0].on.table2Filter;
            $lookup["as"] = tables[0].table2;

            $unwind = {};
            $unwind["path"] = "$" + tables[0].table2;
            $unwind["preserveNullAndEmptyArrays"] = false;
            pipleLine[index++] = {$lookup: $lookup};
            pipleLine[index++] = {$unwind: $unwind};
            for (i in tables) {
                if (i == 0) {
                    continue;
                }
                $lookup = {};
                $lookup["from"] = tables[i].table1;
                $lookup["localField"] =
                    tables[i].table2 + "." + tables[i].on.table2Filter;
                $lookup["foreignField"] = tables[i].on.table1Filter;
                $lookup["as"] = tables[i].table1;

                $unwind = {};
                $unwind["path"] = "$" + tables[i].table1;
                $unwind["preserveNullAndEmptyArrays"] = false;
                pipleLine[index++] = {$lookup: $lookup};
                pipleLine[index++] = {$unwind: $unwind};
            }
        }
    }
    var $match = metaData.filter;
    if ($match) {
        pipleLine[index++] = {$match: $match};
    }
    var $project = metaData.projection;
    var _id = {};
    for (var key in $project) {
        if (key == "_id") continue;
        _id[key] = $project[key];
    }
    var $group = {};
    $group["_id"] = _id;
    pipleLine[index++] = {$group: $group};

    var project = {};
    project["_id"] = 0;
    for (i in $project) {
        project[i] = "$_id." + i;
    }

    if ($project) {
        pipleLine[index++] = {$project: project};
    }
    if (metaData.sort) {
        var sortObj = {};
        for (var key in metaData.sort) {
            var projectionKey = key.split(".").pop();
            projectionKey =
                projectionKey.charAt(0).toUpperCase() + projectionKey.slice(1);
            sortObj[projectionKey] = metaData.sort[key];
        }
        pipleLine[index++] = {$sort: sortObj};
    }
    if (reportFile) {
        var cursor = db.collection(collection).aggregate(pipleLine, options);
        return await cursor.toArray();
    } else {
        var cursor = db
            .collection(collection)
            .aggregate(pipleLine, options)
            .skip(page)
            .limit(size);
        return await cursor.toArray();
    }
}

module.exports = {
    generateMultipleModelReport,
    generateProcessReport,
    exportToPdf,
    exportToCsv,
    exportToExcel,
    getReportFromApacheDrill,
};
