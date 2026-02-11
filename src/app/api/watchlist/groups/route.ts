import { NextRequest, NextResponse } from "next/server";
import {
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "@/lib/data/watchlist";
import { getAuthUserId } from "@/lib/supabase/auth";

export async function GET() {
  try {
    const userId = await getAuthUserId();
    const groups = await getGroups(userId);
    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Groups GET error:", error);
    return NextResponse.json(
      { error: "Failed to get groups" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { name, color } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const group = await createGroup(userId, name.trim(), color);
    return NextResponse.json(group);
  } catch (error) {
    console.error("Groups POST error:", error);
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { id, name, color, sortOrder } = await request.json();
    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }
    const group = await updateGroup(userId, id, { name, color, sortOrder });
    return NextResponse.json(group);
  } catch (error) {
    console.error("Groups PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update group" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }
    await deleteGroup(userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Groups DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete group" },
      { status: 500 }
    );
  }
}
