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

/* IMPORTANT:
   DO NOT USE:
   app.use(express.json())

   MCP needs raw request streams for SSE transport.
*/

/* ---------------- MONGODB ---------------- */

await mongoose.connect(process.env.MONGODB_URI);

console.log("✅ MongoDB Connected");

/* ---------------- USER MODEL ---------------- */

const User =
  mongoose.models.user ||
  mongoose.model(
    "user",
    new mongoose.Schema({
      name: {
        type: String,
        required: true,
      },

      age: {
        type: Number,
        required: true,
      },

      height: {
        type: Number,
        required: true,
      },
    })
  );

/* ---------------- MCP SERVER ---------------- */

const server = new Server(
  {
    name: "user-db-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/* ---------------- LIST TOOLS ---------------- */

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_all_users",
        description: "Fetch all users from database",

        inputSchema: {
          type: "object",
          properties: {},
        },
      },

      {
        name: "find_user_by_name",
        description: "Find user by name",

        inputSchema: {
          type: "object",

          properties: {
            name: {
              type: "string",
              description: "Name of the user",
            },
          },

          required: ["name"],
        },
      },

      {
        name: "insert_user",
        description: "Insert a new user",

        inputSchema: {
          type: "object",

          properties: {
            name: {
              type: "string",
            },

            age: {
              type: "number",
            },

            height: {
              type: "number",
            },
          },

          required: ["name", "age", "height"],
        },
      },

      {
        name: "update_user_by_name",
        description: "Update user by name",

        inputSchema: {
          type: "object",

          properties: {
            name: {
              type: "string",
            },

            new_name: {
              type: "string",
            },

            new_age: {
              type: "number",
            },

            new_height: {
              type: "number",
            },
          },

          required: ["name"],
        },
      },

      {
        name: "delete_user_by_name",
        description: "Delete user by name",

        inputSchema: {
          type: "object",

          properties: {
            name: {
              type: "string",
            },
          },

          required: ["name"],
        },
      },
    ],
  };
});

/* ---------------- TOOL EXECUTION ---------------- */

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    /* ---------- GET ALL USERS ---------- */

    case "get_all_users": {
      const users = await User.find();

      if (users.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No users found",
            },
          ],
        };
      }

      const formattedUsers = users
        .map(
          (u) =>
            `Name: ${u.name} | Age: ${u.age} | Height: ${u.height}cm`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: formattedUsers,
          },
        ],
      };
    }

    /* ---------- FIND USER ---------- */

    case "find_user_by_name": {
      const user = await User.findOne({
        name: {
          $regex: new RegExp(`^${args.name}$`, "i"),
        },
      });

      if (!user) {
        return {
          content: [
            {
              type: "text",
              text: `No user found with name "${args.name}"`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Found user: ${user.name} | Age: ${user.age} | Height: ${user.height}cm`,
          },
        ],
      };
    }

    /* ---------- INSERT USER ---------- */

    case "insert_user": {
      const existing = await User.findOne({
        name: {
          $regex: new RegExp(`^${args.name}$`, "i"),
        },
      });

      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: `User "${args.name}" already exists`,
            },
          ],
        };
      }

      const newUser = await User.create({
        name: args.name,
        age: Number(args.age),
        height: Number(args.height),
      });

      return {
        content: [
          {
            type: "text",
            text: `Inserted user "${newUser.name}" successfully`,
          },
        ],
      };
    }

    /* ---------- UPDATE USER ---------- */

    case "update_user_by_name": {
      const user = await User.findOne({
        name: {
          $regex: new RegExp(`^${args.name}$`, "i"),
        },
      });

      if (!user) {
        return {
          content: [
            {
              type: "text",
              text: `No user found with name "${args.name}"`,
            },
          ],
        };
      }

      const updateFields = {};

      if (args.new_name) {
        updateFields.name = args.new_name;
      }

      if (args.new_age) {
        updateFields.age = Number(args.new_age);
      }

      if (args.new_height) {
        updateFields.height = Number(args.new_height);
      }

      if (Object.keys(updateFields).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No update fields provided",
            },
          ],
        };
      }

      await User.findByIdAndUpdate(user._id, {
        $set: updateFields,
      });

      return {
        content: [
          {
            type: "text",
            text: `Updated user "${args.name}" successfully`,
          },
        ],
      };
    }

    /* ---------- DELETE USER ---------- */

    case "delete_user_by_name": {
      const user = await User.findOne({
        name: {
          $regex: new RegExp(`^${args.name}$`, "i"),
        },
      });

      if (!user) {
        return {
          content: [
            {
              type: "text",
              text: `No user found with name "${args.name}"`,
            },
          ],
        };
      }

      await User.findByIdAndDelete(user._id);

      return {
        content: [
          {
            type: "text",
            text: `Deleted user "${args.name}" successfully`,
          },
        ],
      };
    }

    /* ---------- DEFAULT ---------- */

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

/* ---------------- TRANSPORT STORAGE ---------------- */

const transports = {};

/* ---------------- SSE CONNECTION ---------------- */

app.get("/mcp", async (req, res) => {
  const transport = new SSEServerTransport("/mcp", res);

  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

/* ---------------- HANDLE CLIENT MESSAGES ---------------- */

app.post("/mcp", async (req, res) => {
  const sessionId = req.query.sessionId;

  const transport = transports[sessionId];

  if (!transport) {
    return res.status(400).send("No transport found");
  }

  await transport.handlePostMessage(req, res);
});

/* ---------------- HEALTH CHECK ---------------- */

app.get("/", (req, res) => {
  res.send("✅ User DB MCP Server Running");
});

/* ---------------- START SERVER ---------------- */

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
});