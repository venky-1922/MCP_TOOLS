import dotenv from "dotenv";
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* ---------------- EXPRESS APP ---------------- */
const app = express();

/* ---------------- MONGODB ---------------- */
await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ MongoDB Connected");

/* ---------------- USER MODEL ---------------- */
const User =
  mongoose.models.user ||
  mongoose.model(
    "user",
    new mongoose.Schema({
      name:   { type: String, required: true },
      age:    { type: Number, required: true },
      height: { type: Number, required: true },
    })
  );

/* ---------------- TOOL DEFINITIONS ---------------- */
const TOOLS = [
  {
    name: "get_all_users",
    description: "Fetch all users from the database",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_user_by_name",
    description: "Find a user by their name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the user to find" },
      },
      required: ["name"],
    },
  },
  {
    name: "insert_user",
    description: "Insert a new user into the database",
    inputSchema: {
      type: "object",
      properties: {
        name:   { type: "string", description: "User full name" },
        age:    { type: "number", description: "User age" },
        height: { type: "number", description: "User height in cm" },
      },
      required: ["name", "age", "height"],
    },
  },
  {
    name: "update_user_by_name",
    description: "Update a user's details by their name",
    inputSchema: {
      type: "object",
      properties: {
        name:       { type: "string", description: "Current name of the user" },
        new_name:   { type: "string", description: "New name (optional)" },
        new_age:    { type: "number", description: "New age (optional)" },
        new_height: { type: "number", description: "New height in cm (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_user_by_name",
    description: "Delete a user by their name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the user to delete" },
      },
      required: ["name"],
    },
  },
];

/* ---------------- TOOL HANDLER ---------------- */
async function handleToolCall(request) {
  const { name, arguments: args } = request.params;

  switch (name) {

    case "get_all_users": {
      const users = await User.find();
      if (users.length === 0) {
        return { content: [{ type: "text", text: "No users found in the database" }] };
      }
      const formatted = users
        .map((u) => `Name: ${u.name} | Age: ${u.age} | Height: ${u.height}cm`)
        .join("\n");
      return { content: [{ type: "text", text: `Found ${users.length} users:\n${formatted}` }] };
    }

    case "find_user_by_name": {
      const user = await User.findOne({
        name: { $regex: new RegExp(`^${args.name}$`, "i") },
      });
      if (!user) {
        return { content: [{ type: "text", text: `No user found with name "${args.name}"` }] };
      }
      return {
        content: [{ type: "text", text: `Found: ${user.name} | Age: ${user.age} | Height: ${user.height}cm` }],
      };
    }

    case "insert_user": {
      const existing = await User.findOne({
        name: { $regex: new RegExp(`^${args.name}$`, "i") },
      });
      if (existing) {
        return {
          content: [{
            type: "text",
            text: `User "${existing.name}" already exists with age ${existing.age} and height ${existing.height}cm. What would you like to do?\n1. Update with new details (age: ${args.age}, height: ${args.height}cm)\n2. Cancel`,
          }],
        };
      }
      const newUser = await User.create({
        name: args.name,
        age: Number(args.age),
        height: Number(args.height),
      });
      return { content: [{ type: "text", text: `User "${newUser.name}" inserted successfully!` }] };
    }

    case "update_user_by_name": {
      const user = await User.findOne({
        name: { $regex: new RegExp(`^${args.name}$`, "i") },
      });
      if (!user) {
        return { content: [{ type: "text", text: `No user found with name "${args.name}"` }] };
      }

      const updateFields = {};
      if (args.new_name)   updateFields.name   = args.new_name;
      if (args.new_age)    updateFields.age     = Number(args.new_age);
      if (args.new_height) updateFields.height  = Number(args.new_height);

      if (Object.keys(updateFields).length === 0) {
        return { content: [{ type: "text", text: "No fields provided to update" }] };
      }

      await User.findByIdAndUpdate(user._id, { $set: updateFields }, { returnDocument: "after" });
      return { content: [{ type: "text", text: `User "${args.name}" updated successfully with: ${JSON.stringify(updateFields)}` }] };
    }

    case "delete_user_by_name": {
      const user = await User.findOne({
        name: { $regex: new RegExp(`^${args.name}$`, "i") },
      });
      if (!user) {
        return { content: [{ type: "text", text: `No user found with name "${args.name}"` }] };
      }
      await User.findByIdAndDelete(user._id);
      return { content: [{ type: "text", text: `User "${args.name}" deleted successfully` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ---------------- CREATE MCP SERVER (fresh per connection) ---------------- */
function createMCPServer() {
  const server = new Server(
    { name: "user-db-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, handleToolCall);

  return server;
}

/* ---------------- TRANSPORT STORAGE ---------------- */
const transports = {};

/* ---------------- SSE CONNECTION ---------------- */
app.get("/mcp", async (req, res) => {
  const server = createMCPServer();  // ← fresh instance per connection

  const transport = new SSEServerTransport("/mcp/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    console.log(`🔌 SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  console.log(`✅ New SSE connection: ${transport.sessionId}`);
  await server.connect(transport);
});

/* ---------------- HANDLE CLIENT MESSAGES ---------------- */
app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).send("No transport found for session");
  await transport.handlePostMessage(req, res);
});

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
  res.send("✅ User DB MCP Server Running");
});

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
});